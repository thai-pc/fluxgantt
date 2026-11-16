// The grid cell editors, the LAZY half (see `mixin.ts`): the `cell:edit-requested` event, the editor's DOM, its state
// machine (open, valid or invalid, committing, closed), the calendar-aware write (`commit.ts`) and the announcements.
// Fetched by `mixin.ts` on the first cell focus or edit, so a read-only grid never downloads it; kept out of every
// size fixture like `grid/resize-ui.ts`. DOM-specific.
//
// LAYOUT. The editor is an `<input>` inside `div.fg-grid__editor-host`, which is never a child of a row (the grid's key
// listener and `keyboard-nav` read the keys of any descendant of a row). SVG: the host is a zero-size box in the chart
// layer, sticky on the inline-start axis only, so it pins with the grid column and scrolls with the rows; the input sits
// at the cell's coordinates inside it (logical insets, so RTL needs no mirroring). Canvas: the host is a sibling of the
// canvases, pulled up like the pinned label canvas and sticky on both axes; the input is placed from the row index and
// `scrollTop` on every scroll and every repaint. The host swallows pointer, click, double-click and context-menu events
// so the chart's selection, pan, drag and edit hooks never see them; wheel is not swallowed (the chart still scrolls).
//
// SECURITY (security.md): the input's text is untrusted. It is read as a string, length-checked, parsed (`parse.ts`)
// and never inserted as markup; the error element and the announcements receive text nodes and attribute values only.
// Host messages (`beforeCommit`, a custom editor's `{ error }`) are capped and shown as text.
import { ROW_HEIGHT } from '../render/renderer-base.js';
import { toTaskId } from '../types.js';
import type { EditErrorReason, Task } from '../types.js';
import { announceGrid } from '../grid/announce.js';
import { UNSAFE_TEXT, type Column } from '../grid/columns.js';
import { HEADER_HEIGHT } from '../grid/fit.js';
import { focusCell } from '../grid/resize.js';
import { MAX_MESSAGE_CHARS, planEdit, unschedulable, type Plan } from './commit.js';
import { MAX_NAME_LENGTH } from './parse.js';
import type { EditEnv, OpenEdit } from './mixin.js';

// The SVG host lives as long as the mount (inserting and removing a grid item re-lays out the whole chart layer), so it
// is layout-contained: opening or closing an editor only lays out the host's own subtree. Paint containment would clip
// the input, which overflows the 0x0 box.
const HOST_CSS = 'contain:size layout style;position:sticky;inset-inline-start:0;grid-area:1/1;align-self:start;justify-self:start;width:0;height:0;overflow:visible';
const CANVAS_HOST_CSS = 'position:sticky;top:0;inset-inline-start:0;width:0;height:0;overflow:visible';
const INPUT_CSS =
  'position:absolute;box-sizing:border-box;margin:0;padding:0 8px;font:12px system-ui,sans-serif;color:var(--fg-fg,#18181b);background:var(--fg-bg,#fff);border:2px solid var(--fg-task-focus,#0369a1);border-radius:0;text-overflow:clip';
const ERROR_CSS =
  'position:absolute;z-index:1;box-sizing:border-box;width:max-content;padding:2px 6px;font:12px system-ui,sans-serif;color:var(--fg-fg,#18181b);background:var(--fg-bg,#fff);border:2px dashed #dc2626;pointer-events:none;white-space:normal';
/** Events the host keeps from the chart's listeners. Not `wheel`: wheel over the editor still scrolls and zooms the chart. */
const SWALLOW = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click', 'dblclick', 'contextmenu'] as const;
const ALIGN = { start: 'start', center: 'center', end: 'end' } as const;
/** Two touches this close in time (ms) and space (px) are a double-tap. */
const TAP_MS = 300;
const TAP_PX = 24;

const ENGLISH: Record<EditErrorReason, string> = {
  empty: 'Enter a value.',
  'not-a-number': 'Enter a number.',
  'out-of-range': 'The value is out of range.',
  'not-a-date': 'Enter a valid date.',
  'end-before-start': 'The end must be after the start.',
  'too-long': 'The value is too long.',
  rejected: 'This value could not be saved.',
};

let counter = 0;
const clean = (s: string): string => s.replace(UNSAFE_TEXT, ' ').slice(0, MAX_MESSAGE_CHARS);
/** The persistent SVG host of a mount. */
const hosts = new WeakMap<EditEnv, HTMLElement>();
/** Touch state per mount: the last press, the last tap, and when a double-tap or double-click was last acted on. */
const taps = new WeakMap<EditEnv, { down?: { x: number; y: number; t: number } | undefined; last?: { x: number; y: number; t: number } | undefined; dbl: number }>();

/** The real row element of task `id` (the one with `role=row`, not a pinned clone). */
function findRow(container: HTMLElement, id: string): Element | undefined {
  for (const r of container.querySelectorAll('[role=row][data-task-id]')) if (r.getAttribute('data-task-id') === id) return r;
  return undefined;
}

/** `[top, height]` of Canvas row `idx` in the host's coordinates (the pinned corner: the header band, then the rows). */
function canvasBox(env: EditEnv, idx: number): readonly [number, number] | undefined {
  if (!('getRenderState' in env.handle) || !(idx >= 0)) return undefined;
  const h = ROW_HEIGHT[env.handle.getRenderState().options.density ?? 'default'];
  return [HEADER_HEIGHT + idx * h - env.container.scrollTop, h];
}

/** `[top, height]` of a row in the editor host's own coordinates (the layer for SVG, the pinned corner for Canvas). */
function boxOf(env: EditEnv, row: Element): readonly [number, number] | undefined {
  const idx = Number(row.getAttribute('data-row-index'));
  if (!('paintHooks' in env.handle)) return canvasBox(env, idx);
  // SVG: the label's y is the row's centre, so the row height follows from it at any density.
  const y = Number(row.querySelector('.fg-timeline__row-label')?.getAttribute('y'));
  const h = (y - HEADER_HEIGHT) / (idx + 0.5);
  return Number.isFinite(h) && h > 0 ? [y - h / 2, h] : undefined;
}

/** The cell's centre in viewport coordinates (the pinned column's box is the origin of the cell offsets). */
function centreOf(env: EditEnv, ci: number, [top, h]: readonly [number, number]): readonly [number, number] {
  const { view } = env.internal.gv!();
  const pin = env.container.querySelector('.fg-timeline__sticky-column, canvas.fg-timeline-canvas-labels')?.getBoundingClientRect();
  if (!pin) return [0, 0];
  const mid = view.offs[ci]! + view.cols[ci]!.width / 2;
  const x = env.handle.mirrorX !== undefined ? pin.right - mid : pin.left + mid;
  const y = pin.top + top + h / 2;
  return [Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0];
}

/** True while this env is still the live mount (a deferred key or begin may outlive an unmount or a remount). */
const live = (env: EditEnv): boolean => env.internal.mountOf()?.handle === env.handle;

/**
 * Asks the host (`cell:edit-requested`), then opens the editor on cell `ci` of task `id`. Returns false when the cell
 * cannot be edited, has no row on screen, the host took over, or an editor already open holds an invalid value. A veto
 * is read once the event has run: inside a command the bus queues it, and the editor then opens a microtask later.
 */
export function begin(env: EditEnv, id: string, ci: number, source: 'keyboard' | 'pointer'): boolean {
  const { internal, st } = env;
  if (!live(env) || !env.canEdit(id, ci)) return false;
  const col = internal.gv!().view.all[ci]!;
  // A calendar that cannot place a bar has no start, end or duration to edit.
  if (col.builtIn && ['start', 'end', 'duration'].includes(col.id) && unschedulable(internal.calendar)) return false;
  const row = findRow(env.container, id);
  const box = row && boxOf(env, row);
  if (!row || !box) return false;
  if (st.o?.id === id && st.o.ci === ci) return true; // already editing this cell
  if (st.o && !st.o.end(true, false)) return false; // a second edit first commits the open one
  const [x, y] = centreOf(env, ci, box);
  let prevented = false;
  let ran = false;
  const off = env.gantt.on('cell:edit-requested', () => void (ran = true)); // tells a queued event from one that has run
  internal.emit('cell:edit-requested', {
    taskId: toTaskId(id),
    columnId: col.id,
    source,
    clientX: x,
    clientY: y,
    preventDefault(): void {
      prevented = true;
    },
  });
  const go = (): boolean => {
    off();
    if (prevented || !live(env) || !internal.tasks.has(toTaskId(id))) return false; // vetoed, or gone meanwhile
    open(env, id, ci, Number(row.getAttribute('data-row-index')));
    return true;
  };
  if (ran) return go();
  queueMicrotask(go);
  return true;
}

function open(env: EditEnv, id: string, ci: number, startIdx: number): void {
  const { internal, st, container, handle, opts } = env;
  const g = internal.gv!();
  const { view } = g;
  const col: Column = view.all[ci]!;
  const task0 = internal.tasks.get(toTaskId(id))!;
  const locale = internal.config.locale ?? 'en';
  const canvas = !('paintHooks' in handle);
  const kind = col.builtIn ? col.id : col.editor ? col.editor.type : 'text';
  const ed = col.editor || undefined;

  // The text the editor starts with (the FULL value: the cell may show a cut one).
  let initial = kind === 'name' ? task0.name : g.values.raw(task0, view.all)[ci] ?? '';
  if (ed?.initial) {
    try {
      const v = ed.initial(task0, { locale, calendar: internal.calendar, isSummary: internal.tasks.children(task0.id).length > 0 });
      if (typeof v === 'string') initial = v.slice(0, 1000);
    } catch {
      // the cell's own raw value stands
    }
  }

  // SVG: one host per mount, kept; only the input and the error come and go. Canvas: a host per edit.
  let host = canvas ? undefined : hosts.get(env);
  if (!host?.isConnected) {
    host = document.createElement('div');
    host.className = 'fg-grid__editor-host';
    host.setAttribute('data-fg-focus-keep', ''); // focus handed to the editor is not a focus loss for the Canvas renderer
    host.style.cssText = canvas ? CANVAS_HOST_CSS : HOST_CSS;
    for (const t of SWALLOW) host.addEventListener(t, (e) => e.stopPropagation());
    if (!canvas) hosts.set(env, host);
  }
  const input = document.createElement('input');
  const err = document.createElement('div');
  err.className = 'fg-grid__edit-error';
  err.setAttribute('role', 'alert');
  err.style.cssText = ERROR_CSS + ';display:none';
  input.className = 'fg-grid__editor';
  input.style.cssText = INPUT_CSS;
  input.type = kind === 'date' || kind === 'start' || kind === 'end' ? 'date' : 'text';
  if (input.type === 'text') {
    const cap = kind === 'name' ? MAX_NAME_LENGTH : kind === 'text' ? Math.min(ed?.maxLength ?? 1000, 1000) : 32;
    input.maxLength = cap;
    if (kind === 'duration' || kind === 'number' || kind === 'progress') input.inputMode = 'decimal';
  }
  input.value = initial;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('autocapitalize', kind === 'name' || kind === 'text' ? 'sentences' : 'off');
  input.enterKeyHint = 'done';
  input.style.textAlign = ALIGN[col.align];
  // The duration's unit is not in its raw value, so the accessible name carries it.
  let label = `${col.header}${kind === 'duration' ? ` (${g.unit})` : ''}, ${task0.name}`;
  try {
    const custom = internal.config.messages?.gridEditLabel?.({ columnId: col.id, header: col.header, taskName: task0.name, locale });
    if (typeof custom === 'string') label = custom;
  } catch {
    // a throwing host function falls back to the English name
  }
  input.setAttribute('aria-label', label.replace(UNSAFE_TEXT, ' ').slice(0, 400));

  const text = (reason: EditErrorReason, min?: number, max?: number): string => {
    try {
      const custom = internal.config.messages?.gridEditError?.({ reason, columnId: col.id, header: col.header, locale, ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) });
      if (typeof custom === 'string') return clean(custom);
    } catch {
      // English
    }
    if (reason === 'out-of-range' && min !== undefined && max !== undefined) return `Enter a value from ${min} to ${max}.`;
    return ENGLISH[reason];
  };

  // --- placement -------------------------------------------------------------------------------------------
  // Canvas windows its a11y rows: a row scrolled out of the window has no element, so its index (cached from the last time
  // it had one) places the editor, and the editor is hidden while its row is behind the header or outside the viewport.
  let idx = startIdx;
  const place = (): boolean => {
    const row = findRow(container, id);
    if (row && canvas) idx = Number(row.getAttribute('data-row-index'));
    const box = row ? boxOf(env, row) : canvas ? canvasBox(env, idx) : undefined;
    if (!box) return false;
    const [top, h] = box;
    if (canvas) host!.style.marginTop = container.querySelector<HTMLElement>('canvas.fg-timeline-canvas-labels')?.style.marginTop ?? '0';
    const shown = !canvas || (top >= HEADER_HEIGHT && top + h <= (container.clientHeight || Infinity));
    for (const [el, t, w] of [[input, top, 0], [err, top + h, 1]] as const) {
      el.style.top = `${t}px`;
      el.style.insetInlineStart = `${view.offs[ci]}px`;
      el.style[w ? 'maxWidth' : 'width'] = `${col.width}px`;
      el.style.opacity = shown ? '' : '0';
    }
    input.style.pointerEvents = shown ? '' : 'none';
    input.style.height = `${h}px`;
    return true;
  };

  // --- closing ---------------------------------------------------------------------------------------------
  let closed = false;
  const stops: (() => void)[] = [];
  const finish = (back: boolean): void => {
    if (closed) return;
    closed = true;
    if (st.o === me) st.o = undefined;
    for (const s of stops) s();
    if (canvas) host!.remove();
    else {
      input.remove();
      err.remove();
    }
    if (!back) return;
    // Focus returns to the real cell (a repaint rebuilt it; on Canvas the a11y layer is rebuilt too).
    const row = findRow(container, id);
    if (row && !focusCell(row, ci)) (row as HTMLElement | SVGElement).focus({ preventScroll: true });
  };
  /** Closes without a write and hands focus to the nearest ancestor row that is still shown (the row is collapsed away). */
  const finishHidden = (): void => {
    finish(false);
    for (let p = internal.tasks.get(toTaskId(id))?.parent; p !== undefined; p = internal.tasks.get(p)?.parent) {
      const row = findRow(container, p);
      if (row) return void (row as HTMLElement | SVGElement).focus({ preventScroll: true });
    }
  };
  const showError = (message: string): void => {
    err.textContent = message;
    err.id = `fg-grid-err-${++counter}`;
    err.style.display = 'block';
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', err.id);
    input.style.outline = '2px dashed #dc2626';
    input.style.outlineOffset = '-2px';
  };
  const clearError = (): void => {
    if (err.style.display === 'none') return;
    err.style.display = 'none';
    err.textContent = '';
    err.removeAttribute('id');
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
    input.style.outline = '';
  };

  /** Rolls back a write that threw AFTER it landed (the store writes, records history, then validates and emits): exactly
   *  that one history entry is undone. False when the task is not back to what it was (history off, or undo failed too). */
  const rollBack = (before: Task | undefined): boolean => {
    try {
      if (internal.tasks.revision.peek() !== rev0 && env.gantt.canUndo()) env.gantt.undo();
    } catch {
      // undo's own events can throw too (a throwing `task:updated` listener); what matters is the state afterwards
    }
    const now = internal.tasks.get(toTaskId(id));
    return !!before && !!now && (Object.keys(before) as (keyof Task)[]).every((k) => k === 'updatedAt' || Object.is(before[k], now[k]));
  };
  let rev0 = 0;

  /** Writes the value. ok (written, or nothing to write) closes the editor; not ok shows the error and keeps it open. */
  const commit = (): { ok: true; wrote?: Plan & { kind: 'write' } } | { ok: false; reason: EditErrorReason } => {
    const task = internal.tasks.get(toTaskId(id));
    if (!task) return { ok: true };
    const plan = planEdit({ gantt: env.gantt, internal, unit: g.unit }, task, col, input.value, initial);
    if (plan.kind === 'noop') return { ok: true };
    if (plan.kind === 'error') {
      showError(plan.message === undefined ? text(plan.reason, plan.min, plan.max) : clean(plan.message));
      return { ok: false, reason: plan.reason };
    }
    try {
      const veto = opts.beforeCommit?.({ taskId: task.id, columnId: col.id, input: plan.input, patch: plan.patch });
      if (typeof veto === 'string' && veto) {
        showError(clean(veto));
        return { ok: false, reason: 'rejected' };
      }
    } catch (e) {
      showError(`${text('rejected')} ${clean(e instanceof Error ? e.message : '')}`.trim());
      return { ok: false, reason: 'rejected' };
    }
    rev0 = internal.tasks.revision.peek();
    try {
      plan.run();
    } catch (e) {
      // A throw before the store changed wrote nothing (a bad date, a cascade error: `updateTask` and friends plan first). A throw after it (an `onTaskChange` hook, which runs once the write is announced) leaves the write and its
      // history entry in place: undo exactly that entry; if the task is not back, say so rather than "not saved".
      const msg = clean(e instanceof Error ? e.message : '');
      if (internal.tasks.revision.peek() === rev0 || rollBack(task)) {
        showError(`${text('rejected')} ${msg}`.trim());
        return { ok: false, reason: 'rejected' };
      }
      console.error('@fluxgantt/core: withGridEditing: a write threw after it landed and could not be rolled back.', e);
      return { ok: true, wrote: plan };
    }
    return { ok: true, wrote: plan };
  };
  const announced = (r: ReturnType<typeof commit>): void => {
    const task = internal.tasks.get(toTaskId(id));
    const name = task?.name ?? '';
    if (r.ok) {
      if (!r.wrote || !task) return;
      const shown = clean(g.values.text(task, view.all)[ci] ?? '');
      const snapped = r.wrote.snapped;
      announceGrid(
        internal,
        { kind: 'cell-edited', id: task.id, name, columnId: col.id, header: col.header, text: shown, ...(snapped ? { snapped } : {}), locale },
        `${col.header}: ${shown}${snapped ? `, ${snapped === 'next' ? 'next' : 'previous'} working day` : ''}`,
      );
    } else {
      announceGrid(
        internal,
        { kind: 'cell-edit-failed', id: toTaskId(id), name, columnId: col.id, header: col.header, reason: r.reason, locale },
        `${col.header} not changed: ${text(r.reason)}`,
      );
    }
  };

  const me: OpenEdit = {
    id,
    ci,
    end(write, back = true): boolean {
      if (closed) return true;
      if (write) {
        const r = commit();
        if (!r.ok) return false;
        announced(r);
      }
      finish(back);
      return true;
    },
  };

  // --- keys and focus --------------------------------------------------------------------------------------
  input.addEventListener('input', clearError);
  input.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return; // an IME's Enter chooses a candidate
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      me.end(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      me.end(false);
    } else if (e.key === 'Tab') {
      // Not prevented: commit (or discard an invalid value), focus the cell, and the browser's Tab moves on from it.
      const r = commit();
      announced(r);
      finish(true);
    }
  });
  input.addEventListener('focusout', () => {
    if (closed) return;
    if (opts.commitOnBlur === false) return void finish(false);
    const r = commit();
    announced(r); // a failure is announced as `cell-edit-failed`, then discarded
    finish(false);
  });

  // --- keeping the editor on its cell ------------------------------------------------------------------------
  const hiddenByFold = (): boolean => {
    for (let p = internal.tasks.get(toTaskId(id))?.parent; p !== undefined; p = internal.tasks.get(p)?.parent) if (internal.fold.has(p)) return true;
    return false;
  };
  const sync = (): void => {
    if (closed) return;
    // A column resized, collapsed or replaced moved the cell: the edit is cancelled, not committed.
    if (internal.gv!().view !== view || !internal.tasks.has(toTaskId(id))) return void finish(true);
    // A row collapsed away (or, on SVG, missing for any reason) has nothing to edit.
    if (hiddenByFold() || !place()) finishHidden();
  };
  const mo = new MutationObserver(sync);
  mo.observe(handle.interactionRoot, { childList: true, subtree: true });
  stops.push(() => mo.disconnect());
  if (canvas) {
    let frame = 0;
    const onScroll = (): void => {
      if (!frame) frame = requestAnimationFrame(() => ((frame = 0), closed || place()));
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    stops.push(() => {
      container.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    });
  }
  for (const ev of ['task:removed', 'data:imported'] as const) {
    stops.push(env.gantt.on(ev, (...a: unknown[]) => (ev === 'data:imported' || a[0] === id) && finish(true)));
  }

  // --- mount -----------------------------------------------------------------------------------------------
  if (!host.isConnected) {
    const layer = container.querySelector('.fg-timeline__layer');
    if (canvas) container.querySelector('canvas.fg-timeline-canvas-labels')?.after(host);
    else if (layer) {
      // Above the rows, under the pinned date axis (document order is z-order), like the cell focus ring.
      const band = layer.querySelector(':scope > .fg-timeline__sticky-header');
      if (band) band.before(host);
      else layer.append(host);
    }
  }
  if (!host.isConnected) return; // nowhere to put it
  host.append(input, err);
  st.o = me;
  place();
  input.focus({ preventScroll: true });
  if (input.type === 'text') input.select();
  if (window.matchMedia?.('(pointer:coarse)').matches) input.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

/** Enter or F2 was claimed: act on the cell that has focus now (the key may have waited for this chunk to load). */
export function key(env: EditEnv, f2: boolean): void {
  const a = document.activeElement;
  const at = a && env.container.contains(a) ? env.cellOf(a, f2) : undefined;
  if (at) begin(env, at[0], at[1], 'keyboard');
}

/**
 * A `dblclick` the shell resolved and claimed (`at`), or a touch `pointerdown` / `pointerup` that may be part of a double-tap.
 * A tap is a press and a release within 500 ms and 10 px (a swipe, a pan or a long press is not one); two taps within 300 ms
 * and 24 px are a double-tap, whatever the host then does with it, so the browser's own `dblclick` that follows is ignored.
 */
export function dbl(env: EditEnv, e: Event, at?: readonly [string, number]): void {
  const m = e as MouseEvent;
  const t = taps.get(env) ?? (taps.set(env, { dbl: -Infinity }), taps.get(env)!);
  if (e.type === 'pointerdown') {
    t.down = { x: m.clientX, y: m.clientY, t: e.timeStamp };
    return;
  }
  if (e.type === 'pointerup') {
    const [d, prev] = [t.down, t.last];
    t.down = undefined;
    t.last = d && Math.hypot(m.clientX - d.x, m.clientY - d.y) <= 10 && e.timeStamp - d.t <= 500 ? { x: m.clientX, y: m.clientY, t: e.timeStamp } : undefined;
    if (!t.last || !prev || e.timeStamp - prev.t > TAP_MS || Math.hypot(m.clientX - prev.x, m.clientY - prev.y) > TAP_PX) return;
    [t.last, t.dbl] = [undefined, e.timeStamp];
    const hit = env.hit(e.target as Element, m.clientX, m.clientY);
    // A double-tap is seen at its second `pointerup`, ahead of `selection`'s own window listener, which hands focus to the
    // tapped row: open one task later, or that would take the focus straight back from the editor.
    if (hit) setTimeout(() => begin(env, hit[0], hit[1], 'pointer'));
    return;
  }
  if (e.timeStamp - t.dbl < 800) return; // the browser's own dblclick after a double-tap we already handled
  if (at) begin(env, at[0], at[1], 'pointer');
}
