// Opt-in host edit hooks (spec-host-edit-hooks.md; spec §8.4). Headless direction: core EMITS
// `task:activated` / `task:context-requested`, the host builds its own editor / menu. No UI ships.
//
//   const gantt = withEditHooks(withInteraction(withRender(createGantt({ tasks }))));
//   gantt.on('task:activated', ({ taskId }) => openEditor(gantt.getTask(taskId)));
//   gantt.on('task:context-requested', (p) => { p.preventDefault(); openMenu(p); });
//
// Same shape as `responsive/mixin.ts` and `theme/mixin.ts`: no instance methods, wired from the
// public `renderer:selected` event (so application order vs `withRender`/`withInteraction` is
// irrelevant), composed over `destroy()`. It deliberately imports nothing from `interaction/` or
// `render/` (module isolation: those graphs must not leak into this subpath's fixture).
//
// KEYBOARD ORDER DEPENDENCE: the `keydown` listener is installed from `renderer:selected`, which
// is emitted AFTER `mount()` wired `interaction/keyboard-nav.ts`'s listener on the same root, so
// keyboard-nav sees Enter first. On a summary row it calls `preventDefault()` (collapse toggle) and
// this module checks `defaultPrevented` to leave that behaviour intact. Do not reorder.
import type { GanttInstance, TaskContextRequestedPayload, TaskHitPart } from '../gantt.js';
import { getInternal } from '../gantt-internal.js';
import { toTaskId, type TaskId } from '../types.js';

export interface EditHooksOptions {
  /** Touch long-press delay (ms) before `task:context-requested` fires. Default 500. `0`, a
   *  negative or a non-finite value disables the touch long-press. Keep it at or below ~500 on
   *  Android, where Chrome's native `contextmenu` (callout) arrives at about that time and can only
   *  be suppressed once the host has already prevented the long-press event. */
  readonly longPressMs?: number;
}

/** Keep in sync with `DEFAULT_DRAG_THRESHOLD_PX` in `interaction/pointer-drag.ts` (not imported:
 *  it would drag the drag coordinator into this subpath's graph). */
const DRAG_THRESHOLD_PX = 4;
/** Touch slop: larger than the mouse threshold because fingers jitter. */
const TOUCH_SLOP_PX = 8;

interface Hit {
  readonly id: TaskId;
  readonly part: TaskHitPart;
  /** Canvas: the point is on the bar, where a drag (4 px) can start. */
  readonly onBar?: boolean;
}

export function withEditHooks<T extends GanttInstance>(instance: T, options: EditHooksOptions = {}): T {
  const internal = getInternal(instance);
  const ms = options.longPressMs ?? 500;
  const longPressMs = ms > 0 && Number.isFinite(ms) ? ms : 0;

  let disposed = false;
  let uninstall: (() => void) | undefined;

  function install(): void {
    uninstall?.();
    uninstall = undefined;
    const mount = internal.mountOf();
    if (disposed || !mount) return;
    const handle = mount.handle;
    const pointerTarget = handle.pointerEventTarget;
    const root = handle.interactionRoot;

    // Last pointerdown (position + type) and the origin of the next native `contextmenu`.
    let down: { x: number; y: number } | undefined;
    let origin: 'keyboard' | 'touch' | undefined;
    let originPrevented = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let press:
      | { hit: Hit; x: number; y: number; px: number; py: number; slop: number; pid: number }
      | undefined;

    const resolve = (target: EventTarget | null, x: number, y: number): Hit | undefined => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
      let id: string | null;
      let part: TaskHitPart = 'row';
      let onBar = false;
      if (handle.hitTestRow) {
        const hit = handle.hitTestRow(x, y);
        if (!hit || hit.hitToggle) return undefined;
        id = hit.taskId;
        onBar = hit.onBar === true;
        if (hit.onLabel) part = 'label';
      } else {
        if (!(target instanceof Element) || target.closest('.fg-timeline__row-toggle')) return undefined;
        // The painted grid sits outside the row groups: fall back to the row spanning y.
        const row =
          target.closest('[data-row-index]') ??
          (target.closest('.fg-timeline__grid') &&
            Array.from(root.querySelectorAll('[data-row-index]')).find((r) => {
              const b = r.getBoundingClientRect();
              return y >= b.top && y < b.bottom;
            }));
        if (!row) return undefined;
        id = row.getAttribute('data-task-id');
        if (target.closest('.fg-task')) part = 'bar';
        else if (target.closest('.fg-timeline__row-label')) part = 'label';
      }
      // A forged or stale id never leaves the library.
      return id !== null && internal.tasks.has(toTaskId(id)) ? { id: toTaskId(id), part, onBar } : undefined;
    };

    /** Emits the context event; resolves to whether the host called `preventDefault()`. */
    const emitContext = (
      hit: Hit,
      source: TaskContextRequestedPayload['source'],
      x: number,
      y: number,
    ): boolean => {
      let prevented = false;
      internal.emit('task:context-requested', {
        taskId: hit.id,
        part: hit.part,
        source,
        clientX: x,
        clientY: y,
        preventDefault(): void {
          prevented = true;
        },
      });
      return prevented;
    };

    const cancelPress = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      press = undefined;
    };

    const onPointerDown = (raw: Event): void => {
      const e = raw as PointerEvent;
      cancelPress(); // a second pointerdown always cancels a pending long-press
      origin = undefined;
      down = { x: e.clientX, y: e.clientY };
      if (e.pointerType !== 'touch') return;
      origin = 'touch';
      originPrevented = false;
      if (longPressMs <= 0 || !e.isPrimary || e.button !== 0) return;
      const hit = resolve(e.target, e.clientX, e.clientY);
      if (!hit) return;
      const state = {
        hit,
        x: e.clientX,
        y: e.clientY,
        px: e.clientX,
        py: e.clientY,
        // On a bar, a drag (4 px) must win over the long-press; elsewhere nothing can drag, so
        // the wider touch slop applies.
        slop: hit.part === 'bar' || hit.onBar ? DRAG_THRESHOLD_PX : TOUCH_SLOP_PX,
        pid: e.pointerId,
      };
      press = state;
      timer = setTimeout(() => fireLongPress(state), longPressMs);
    };

    const fireLongPress = (state: NonNullable<typeof press>): void => {
      cancelPress();
      // `unmount()` has no hook: bail out unless this handle is still the mounted one.
      if (disposed || internal.mountOf()?.handle !== handle) return;
      // The row may have been removed meanwhile (a repaint alone keeps the id valid).
      if (!internal.tasks.has(state.hit.id)) return;
      originPrevented = emitContext(state.hit, 'long-press', state.px, state.py);
      // The gesture now belongs to the host's menu: end it for the drag / selection recognizers
      // (both treat a window `pointercancel` as a cancel and commit nothing).
      // Only `pointerId` is read by those listeners, so a plain bubbling Event carrying it is
      // enough and works where `PointerEvent` is missing.
      pointerTarget.dispatchEvent(
        Object.assign(new Event('pointercancel', { bubbles: true }), { pointerId: state.pid }),
      );
    };

    const onPointerMove = (raw: Event): void => {
      const e = raw as PointerEvent;
      if (!press) return;
      press.px = e.clientX;
      press.py = e.clientY;
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) >= press.slop) cancelPress();
    };

    const onDblClick = (raw: Event): void => {
      const e = raw as MouseEvent;
      // A drag that browsers still report as a dblclick is not an activation.
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) >= DRAG_THRESHOLD_PX) return;
      const hit = resolve(e.target, e.clientX, e.clientY);
      if (!hit) return;
      internal.emit('task:activated', {
        taskId: hit.id,
        part: hit.part,
        source: 'pointer',
        clientX: e.clientX,
        clientY: e.clientY,
      });
    };

    const onContextMenu = (raw: Event): void => {
      const e = raw as MouseEvent;
      if (origin === 'touch' && press) {
        // Android's native touch menu beat our timer (it can be as early as 400 ms): report the
        // long-press now so the behaviour does not depend on `longPressMs`.
        fireLongPress(press);
      }
      if (origin !== undefined) {
        // Synthesized by a key press or a touch long-press we already reported: never a second
        // event; only forward the host's earlier decision.
        if (originPrevented) e.preventDefault();
        return;
      }
      const hit = resolve(e.target, e.clientX, e.clientY);
      if (!hit) return;
      if (emitContext(hit, 'pointer', e.clientX, e.clientY)) e.preventDefault();
    };

    const onKeyDown = (raw: Event): void => {
      const e = raw as KeyboardEvent;
      // An auto-repeat must not clear the dedupe flag: the key's native `contextmenu` may only
      // arrive on keyup (Windows ContextMenu key).
      if (e.repeat) return;
      origin = undefined;
      const target = e.target;
      const rowEl = target instanceof Element ? target.closest('[data-row-index]') : null;
      if (!rowEl || e.isComposing) return;
      const plain = !(e.ctrlKey || e.metaKey || e.altKey || e.shiftKey);
      const menu = e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey && !(e.ctrlKey || e.metaKey || e.altKey));
      const activate = plain && (e.key === 'F2' || (e.key === 'Enter' && !e.defaultPrevented));
      if (!menu && !activate) return;
      const idAttr = rowEl.getAttribute('data-task-id');
      if (idAttr === null || !internal.tasks.has(toTaskId(idAttr))) return;
      const id = toTaskId(idAttr);
      // Anchor: centre of the focused row; a degenerate rect (windowed Canvas ARIA layer) falls
      // back to the chart's top-left plus the label column, never NaN.
      // Canvas: the ARIA layer is a 1 px hidden strip, so anchor on the painted row instead.
      const painted = handle.getRowAnchor?.(Number(rowEl.getAttribute('data-row-index')));
      let rect = rowEl.getBoundingClientRect();
      let x = painted ? painted.clientX : rect.left + rect.width / 2;
      let y = painted ? painted.clientY : rect.top + rect.height / 2;
      if (!Number.isFinite(x) || !Number.isFinite(y) || (!painted && !(rect.width > 0 && rect.height > 0))) {
        rect = root.getBoundingClientRect();
        x = (Number.isFinite(rect.left) ? rect.left : 0) + handle.getLabelColumnWidth();
        y = Number.isFinite(rect.top) ? rect.top : 0;
      }
      if (activate) {
        e.preventDefault();
        internal.emit('task:activated', { taskId: id, part: 'row', source: 'keyboard', clientX: x, clientY: y });
        return;
      }
      origin = 'keyboard';
      originPrevented = emitContext({ id, part: 'row' }, 'keyboard', x, y);
      if (originPrevented) e.preventDefault();
    };

    const ptr: ReadonlyArray<readonly [string, (e: Event) => void]> = [
      ['pointerdown', onPointerDown],
      ['pointermove', onPointerMove],
      ['pointerup', cancelPress],
      ['pointercancel', cancelPress],
      ['dblclick', onDblClick],
      ['contextmenu', onContextMenu],
    ];
    // Canvas: a keyboard-generated `contextmenu` targets the focused row in the ARIA layer, which
    // is not inside the `<canvas>`; the same handler forwards the host's decision there too.
    for (const [type, fn] of ptr) pointerTarget.addEventListener(type, fn);
    root.addEventListener('keydown', onKeyDown);
    if (!pointerTarget.contains(root)) root.addEventListener('contextmenu', onContextMenu);
    uninstall = (): void => {
      cancelPress();
      for (const [type, fn] of ptr) pointerTarget.removeEventListener(type, fn);
      root.removeEventListener('keydown', onKeyDown);
      root.removeEventListener('contextmenu', onContextMenu);
    };
  }

  instance.on('renderer:selected', install);

  const destroy = instance.destroy.bind(instance);
  return Object.assign(instance, {
    destroy(): void {
      if (!disposed) {
        disposed = true;
        uninstall?.();
        uninstall = undefined;
      }
      destroy();
    },
  });
}
