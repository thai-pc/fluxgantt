// Opt-in inline cell editors for the grid (spec-grid-columns.md sections 2.2, 9.2 and 10; PR G6).
//
//   const gantt = withGridEditing(withGrid(withInteraction(withRender(createGantt({ tasks })))));
//
// This file is the EAGER SHELL and is kept small on purpose (it is in the 4th hard size gate): it decides, at once,
// whether a key or a gesture belongs to an editable cell and so must be claimed (`preventDefault`, so the key does not
// toggle a row, open `withEditHooks`' `task:activated` or move the browser), and it keeps the open-editor slot. Everything
// else (the `cell:edit-requested` event, the editor DOM, parsing, the calendar-aware write, the announcements) is the
// lazy chunk `editing-ui.ts`, fetched when a cell first takes focus or is first edited. A key claimed before the chunk
// has loaded acts a moment later, on the cell that has focus THEN (as the grid's own keyboard model does).
//
// Same shape as `grid/mixin.ts`: wired from `renderer:selected` (application order vs `withRender` is irrelevant),
// undone by the wrapped `handle.destroy`, imports nothing from `interaction/` or `render/`. The listeners are on the
// container in the CAPTURE phase, so they run before `keyboard-nav` and `withEditHooks`; the editor itself lives
// OUTSIDE every row element (the grid's key listener, and `keyboard-nav`, read any key from a descendant of a row).
import type { GanttInstance } from '../gantt.js';
import { getInternal } from '../gantt-internal.js';
import type { GanttInternal } from '../gantt-internal.js';
import type { CanvasRendererHandle } from '../render/canvas-renderer.js';
import type { SvgRendererHandle } from '../render/svg-renderer.js';
import { toTaskId } from '../types.js';
import type { GridCapability } from '../grid/types.js';
import type * as Ui from './editing-ui.js';
import type { GridEditingCapability, GridEditingOptions } from './types.js';

/** The open editor, as the shell sees it. */
export interface OpenEdit {
  readonly id: string;
  /** Index into the grid's `all` columns. */
  readonly ci: number;
  /** Closes the editor: `commit` writes the value first (false when it is invalid, and then the editor stays open);
   *  `back` returns focus to the cell. */
  end(commit: boolean, back?: boolean): boolean;
}

/** What the lazy half needs from the shell, per mount. */
export interface EditEnv {
  readonly container: HTMLElement;
  readonly handle: SvgRendererHandle | CanvasRendererHandle;
  readonly gantt: GanttInstance;
  readonly internal: GanttInternal;
  readonly opts: GridEditingOptions;
  /** The open editor (one per instance). */
  readonly st: { o?: OpenEdit | undefined };
  /** Whether cell `ci` (an index into the grid's columns) of task `id` may be edited now. */
  canEdit(id: string, ci: number): boolean;
  /** The editable cell `t` is, or that F2 on a row means (the name cell): `[taskId, columnIndex]`. */
  cellOf(t: Element | null, f2: boolean): readonly [string, number] | undefined;
  /** The editable cell under a pointer (`[taskId, columnIndex]`): SVG through `colAt`, Canvas through `hitTestRow`. */
  hit(t: Element, x: number, y: number): readonly [string, number] | undefined;
}

/**
 * Adds inline editors to the grid's cells. Apply it AFTER `withGrid` (it throws otherwise) and, like `withGrid`,
 * before the first `mount()`.
 *
 * - Editors: `name` is text; `start` and `end` are native date fields; `duration` is a decimal number in the column's
 *   unit (a text field with a numeric keyboard, not `type=number`); `progress` is a percent (text, 0 to 100, one
 *   decimal). A custom column opts in with `editor`. A summary's rolled-up cells are never editable, a milestone has
 *   no end or duration, and a `readOnly` chart edits nothing.
 * - Gestures: Enter (on a focused cell) and F2 (on a row, meaning its name cell, or on a cell) open the editor; so does
 *   a double-click or double-tap on a pinned cell. Enter or Tab commits, Escape cancels, blur commits a valid value
 *   (`commitOnBlur`) and discards an invalid one. On a cell that is NOT editable, Enter and F2 behave exactly as
 *   without this mixin (a parent row's Enter toggles it, `withEditHooks` reports the cell). A double-click or
 *   double-tap on an editable cell is claimed the same way: the editor opens and `task:activated` does NOT fire (on a
 *   cell that is not editable it fires as before).
 * - Each edit is ONE store write (`updateTask`, `resizeTask` or `setProgress`): one undo entry, one `task:updated`.
 *   A start date keeps the bar's working duration and snaps forward to a working day; an end date snaps back to one
 *   and must stay after the start; a value that changes nothing writes nothing.
 * - `cell:edit-requested` fires first; `preventDefault()` in its listener opens your own editor instead.
 * - Accessibility (WCAG 2.1.1 keyboard, 3.3.1 error identification): the input is named by `messages.gridEditLabel`,
 *   an invalid value sets `aria-invalid` and shows the message in a `role="alert"` element; results are announced
 *   through `withInteraction`'s live region (without it, focus returning to the cell makes the screen reader read it).
 *   A cell gets `aria-readonly="true"` when it takes focus and is not editable.
 * - The editor code loads on first use; the first key after a cell takes focus may act a moment late. A resize of a
 *   column, `collapseBelow`, `setGridColumns`, removing the task or an import closes the editor without a write; moving to another window or tab commits
 *   it, as a blur does (`commitOnBlur: false` discards it).
 *   Out of scope: type-to-edit, range copy and paste, select or user-picker editors (build them on
 *   `cell:edit-requested`).
 *
 * @beta
 */
export function withGridEditing<T extends GanttInstance & GridCapability>(
  instance: T,
  options: GridEditingOptions = {},
): T & GridEditingCapability {
  const internal = getInternal(instance);
  const grid = internal.gv;
  if (!grid) throw new Error('@fluxgantt/core: withGridEditing needs withGrid applied first.');
  const st: EditEnv['st'] = {};
  const act = options.activate ?? ['enter', 'f2', 'dblclick'];
  let ui: Promise<typeof Ui | undefined> | undefined;
  let mod: typeof Ui | undefined;
  const load = (): Promise<typeof Ui | undefined> =>
    (ui ??= import('./editing-ui.js').then(
      (m) => (mod = m),
      (e: unknown) => {
        ui = undefined;
        console.warn('@fluxgantt/core: withGridEditing could not load its editor code.', e);
        return undefined;
      },
    ));
  let cur: EditEnv | undefined; // the live mount's env

  const canEdit = (id: string, ci: number): boolean => {
    const { view } = grid();
    const c = view.all[ci];
    const t = internal.tasks.get(toTaskId(id));
    if (!c || !t || ci >= view.cols.length || internal.config.readOnly || c.editor === false) return false;
    const rolled = internal.tasks.children(t.id).length > 0;
    const open = c.builtIn
      ? c.id === 'name' || !(rolled || (t.type === 'milestone' && (c.id === 'end' || c.id === 'duration')))
      : !!c.editor;
    return open && options.isEditable?.(t, c.id) !== false;
  };
  const locate = (t: Element | null, f2: boolean): [string, number] | undefined => {
    const id = t?.closest('[data-row-index]')?.getAttribute('data-task-id');
    const cell = t?.closest('[role=gridcell]');
    return id && (cell || f2) ? [id, cell ? Number(cell.getAttribute('aria-colindex')) - 1 : 0] : undefined;
  };
  const cellOf: EditEnv['cellOf'] = (t, f2) => {
    const at = locate(t, f2);
    return at && canEdit(...at) ? at : undefined;
  };

  instance.on('renderer:selected', () => {
    const handle = internal.mountOf()?.handle;
    if (!handle) return;
    const hit: EditEnv['hit'] = (t, x, y) => {
      let id: string | null | undefined;
      let col: string | undefined;
      if ('paintHooks' in handle) {
        const at = internal.colAt?.(t, x, y);
        [id, col] = [(t.closest('[data-row-index]') ?? at?.[1])?.getAttribute('data-task-id'), at?.[0]];
      } else {
        const h = handle.hitTestRow(x, y);
        [id, col] = h && !h.hitToggle ? [h.taskId, h.columnId] : [];
      }
      const ci = grid().view.all.findIndex((c) => c.id === col);
      return id && canEdit(id, ci) ? [id, ci] : undefined;
    };
    const env: EditEnv = { container: handle.container, handle, gantt: instance, internal, opts: options, st, canEdit, cellOf, hit };
    cur = env;
    const c = env.container;
    // Claimed here, synchronously: a deferred `preventDefault` would let Enter toggle the row.
    const onKey = (ev: Event): void => {
      const e = ev as KeyboardEvent;
      const t = e.target as Element;
      const f2 = e.key === 'F2';
      if (
        !(f2 ? act.includes('f2') : e.key === 'Enter' && act.includes('enter')) ||
        e.defaultPrevented ||
        e.isComposing ||
        e.ctrlKey || e.metaKey || e.altKey || e.shiftKey ||
        t.closest?.('input,textarea,select,[contenteditable]') ||
        !cellOf(t, f2)
      ) return;
      e.preventDefault();
      e.stopPropagation();
      void load().then((m) => m?.key(env, f2));
    };
    // A double-click on an editable cell is claimed here too (the editor opens, `task:activated` does not fire, as for
    // Enter and F2). A touch's down and up go to the lazy half, which pairs them into a double-tap.
    const onPointer = (e: Event): void => {
      const p = e as PointerEvent;
      const dbl = e.type === 'dblclick';
      if (!act.includes('dblclick') || (!dbl && p.pointerType !== 'touch') || (e.target as Element).closest?.('input')) return;
      const at = dbl ? hit(e.target as Element, p.clientX, p.clientY) : undefined;
      if (dbl) {
        if (!at) return;
        e.stopPropagation();
      }
      void load().then((m) => m?.dbl(env, e, at));
    };
    const onFocus = (e: Event): void => {
      const t = e.target as Element;
      const at = t.getAttribute?.('role') === 'gridcell' ? locate(t, false) : undefined;
      if (!at) return;
      const ok = canEdit(...at);
      if (ok) void load(); // preload: the first key after a focus should not wait for the chunk
      if (ok) t.removeAttribute('aria-readonly');
      else t.setAttribute('aria-readonly', 'true');
    };
    c.addEventListener('keydown', onKey, true);
    c.addEventListener('dblclick', onPointer, true);
    c.addEventListener('pointerup', onPointer, true);
    c.addEventListener('pointerdown', onPointer, true);
    c.addEventListener('focusin', onFocus);
    const inner = handle.destroy;
    handle.destroy = (): void => {
      st.o?.end(false, false);
      c.removeEventListener('keydown', onKey, true);
      c.removeEventListener('dblclick', onPointer, true);
      c.removeEventListener('pointerup', onPointer, true);
      c.removeEventListener('pointerdown', onPointer, true);
      c.removeEventListener('focusin', onFocus);
      if (cur === env) cur = undefined;
      inner.call(handle);
    };
  });

  const capability: GridEditingCapability = {
    startCellEdit(taskId, columnId) {
      internal.alive('startCellEdit');
      const env = cur;
      const ci = grid().view.all.findIndex((c) => c.id === columnId);
      if (!env || !canEdit(taskId, ci)) return false;
      if (mod) return mod.begin(env, taskId, ci, 'keyboard');
      void load().then((m) => m?.begin(env, taskId, ci, 'keyboard'));
      return true;
    },
    cancelCellEdit(): void {
      internal.alive('cancelCellEdit');
      st.o?.end(false);
    },
    isEditingCell: () => !!st.o,
  };
  return Object.assign(instance, capability);
}
