// Interaction layer — roving-tabindex keyboard navigation (spec-keyboard-nav.md §4).
// Arrow Up/Down move focus (select-follows-focus), Shift+Arrow extends a range selection,
// Space toggles the focused row's selection membership, Delete/Backspace removes every
// selected task. Ctrl/Cmd+Z undoes the most recent history entry, Ctrl/Cmd+Shift+Z redoes
// it — both gated by `isReadOnly()` like Delete/Backspace. Ctrl/Cmd+Plus (`'+'`/`'='`) zooms
// in, Ctrl/Cmd+Minus (`'-'`) zooms out — neither gated by `isReadOnly()`, since zoom mutates
// no store state. Delegates a SINGLE `keydown`
// listener on `handle.svg` (spec §4.4's
// recommended topology — consistent with `enableClickSelect`'s single-listener-on-svg-root
// style, and avoids re-attaching N per-row listeners on every full repaint).
//
// TOUCHES THE DOM (native KeyboardEvent + `document.activeElement`/`.focus()`) — this is
// the interaction layer, explicitly permitted per architecture.md. Still imports nothing
// outside `@fluxgantt/core`'s own tree (no react/vue/svelte).
import type { SvgRendererHandle } from '../render/svg-renderer.js';
import { layoutRows, type RowLayout } from '../render/renderer-base.js';
import type { Density, Task, TaskId } from '../types.js';

export interface KeyboardNavOptions {
  /** Arrow Up/Down: replace selection with exactly the newly focused task. */
  onSelect: (id: TaskId) => void;
  /** Space: toggle the focused task's membership in the selection. */
  onToggle: (id: TaskId) => void;
  /** Shift+Arrow Up/Down: extend range selection from the anchor to the newly focused task. */
  onRangeSelect: (anchorId: TaskId, focusId: TaskId) => void;
  /** Delete/Backspace: remove every currently selected task. Not invoked when read-only. */
  onDeleteSelected: () => void;
  /** Ctrl/Cmd+Z (no Shift): undo the most recently committed history entry. Not invoked when
   *  read-only, mirroring `onDeleteSelected`'s gate exactly. A no-op on an empty undo stack is
   *  the caller's (`gantt.undo()`'s) responsibility to handle safely — this module does not
   *  know or care whether the stack is empty; it always calls through when the gesture is
   *  recognized and not read-only. */
  onUndo: () => void;
  /** Ctrl/Cmd+Shift+Z: redo the most recently undone history entry. Same gating posture as
   *  `onUndo`. */
  onRedo: () => void;
  /** Ctrl/Cmd + Plus (`'+'` or `'='`, Shift-independent): step the view one level toward
   *  `'day'`. NOT gated by `isReadOnly()` — zoom is a pure view/viewport concern, touches zero
   *  `TaskStore`/`DependencyStore` state, unlike Delete/undo/redo above. A no-op at the `'day'`
   *  boundary is `gantt.zoomIn()`'s own responsibility to handle safely (already shipped,
   *  PR #25) — this module always calls through when the gesture is recognized, with no
   *  readOnly check of its own. */
  onZoomIn: () => void;
  /** Ctrl/Cmd + Minus (`'-'`, Shift-independent): step the view one level toward `'year'`. Same
   *  never-gated posture as `onZoomIn`. */
  onZoomOut: () => void;
  /** Read-only tasks accessor — same contract as `enableClickSelect`'s `getTasks`: full
   *  `Task[]`, re-read fresh on every keydown (never cached), and fed straight into
   *  `layoutRows` for row-order resolution. */
  getTasks: () => readonly Task[];
  /** Density, forwarded to `layoutRows` for row-order resolution (matches the renderer's
   *  own density). */
  density: Density;
  /** True while `gantt.readOnly` — gates the destructive Delete action AND the undo/redo
   *  keybindings (both are mutating keyboard gestures; see plan decision #3 for why undo/redo
   *  mirrors Delete's gate rather than diverging from it). Deliberately NOT consulted by the
   *  zoom-in/zoom-out case arms — see `onZoomIn`'s doc above and spec-zoom-keybinding.md §4. */
  isReadOnly: () => boolean;
  /** Read the CURRENT flattened selection (ids), used once at setup time to resolve the
   *  initial focused row (spec §4.2) — not read again afterward (selection changes after
   *  setup are driven by this module's own callbacks, which already track focus). */
  getSelection: () => readonly TaskId[];
}

export interface KeyboardNavHandle {
  dispose: () => void;
  getFocusedTaskId: () => TaskId | undefined;
}

/**
 * Attaches roving-tabindex keyboard navigation to a mounted `SvgRendererHandle`. Returns
 * `{ dispose, getFocusedTaskId }` — NOT a bare disposer (a deliberate, documented deviation
 * from `enableClickSelect`'s bare-function return: the renderer needs a live read of the
 * current focus state on every render to thread `focusedTaskId` through `SvgRendererInput`
 * and restore DOM focus after each full repaint — spec §4.5 point 2).
 */
export function enableKeyboardNav(
  handle: SvgRendererHandle,
  options: KeyboardNavOptions,
): KeyboardNavHandle {
  let disposed = false;

  // Task ids, never row indices — row order is always re-derived fresh from `layoutRows()`
  // on every interaction (spec §4.1/§4.3), never cached, so external mutation (host app
  // add/removeTask between renders) is always reflected correctly.
  let focusedTaskId: TaskId | undefined;
  let anchorTaskId: TaskId | undefined;

  // --- Initial focus resolution (spec §4.2) — synchronous, once, at setup time. --------
  {
    const rows = layoutRows(options.getTasks(), options.density);
    const selection = new Set(options.getSelection());
    if (selection.size > 0) {
      const firstSelectedRow = rows.find((r) => selection.has(r.task.id));
      focusedTaskId = firstSelectedRow?.task.id ?? rows[0]?.task.id;
    } else {
      focusedTaskId = rows[0]?.task.id;
    }
    anchorTaskId = focusedTaskId;
  }

  handle.svg.addEventListener('keydown', onKeyDown);

  return { dispose, getFocusedTaskId };

  function getFocusedTaskId(): TaskId | undefined {
    return focusedTaskId;
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (disposed) return;

    // Delegated single listener on `handle.svg` (spec §4.4) — only react to a keydown whose
    // target is genuinely inside a row (i.e. the currently-focused row, since roving
    // tabindex makes exactly one row focusable at a time). A keydown bubbling up from some
    // unrelated descendant (e.g. a future non-row focusable element) is ignored.
    const target = event.target;
    if (!(target instanceof Element) || !target.closest('.fg-timeline__row')) return;

    // Fresh, never cached (spec §4.3) — correctness even if tasks were added/removed by
    // any other code path between the last render and this keydown.
    const rows = layoutRows(options.getTasks(), options.density);
    const currentIndex = rows.findIndex((r) => r.task.id === focusedTaskId);

    switch (event.key) {
      case 'ArrowDown':
        handleArrow(event, rows, currentIndex, 1);
        return;
      case 'ArrowUp':
        handleArrow(event, rows, currentIndex, -1);
        return;
      case 'ArrowLeft':
      case 'ArrowRight':
        // No-op, `preventDefault()` NOT called (reserved for future horizontal/cell nav —
        // spec §4.4).
        return;
      case ' ':
      case 'Spacebar': // legacy key value some UAs still report for Space
        event.preventDefault();
        if (focusedTaskId !== undefined) options.onToggle(focusedTaskId);
        return;
      case 'Delete':
      case 'Backspace':
        if (options.isReadOnly()) return; // no-op, event not prevented (spec §4.4)
        event.preventDefault();
        handleDelete(rows);
        return;
      case 'z':
      case 'Z':
        // Ctrl/Cmd+Z (undo) and Ctrl/Cmd+Shift+Z (redo) share the SAME `event.key` value —
        // 'z' vs 'Z' is governed by Shift alone, never by Ctrl/Cmd — so this is necessarily
        // one case arm with an internal `event.shiftKey` branch, not two separate case labels
        // (a switch cannot match on modifier state as a case label). Cross-platform modifier
        // check reuses the exact pattern already established at selection.ts:150
        // (`event.ctrlKey || event.metaKey`, no separate Mac/Windows branching).
        if (!(event.ctrlKey || event.metaKey)) return; // plain 'z'/'Z', no modifier — not this binding's concern, not prevented
        if (options.isReadOnly()) return; // no-op, event not prevented (mirrors Delete/Backspace's gate exactly)
        event.preventDefault();
        if (event.shiftKey) {
          options.onRedo();
        } else {
          options.onUndo();
        }
        return;
      case '+':
      case '=':
        // Ctrl/Cmd + Plus (zoom in). `'='` covers the common unshifted `Ctrl+=` keystroke
        // (US-layout main-row key, no Shift — also the browser's own native page-zoom-in
        // gesture); `'+'` covers the literal Shift+`=` press AND Numpad `+` (which reports
        // `'+'` unambiguously regardless of Shift). `event.shiftKey` is deliberately NOT
        // checked — unlike `z`/`Z` above, Plus has no paired opposite action sharing the same
        // physical key, so Shift state is incidental, not semantic. NOT gated by
        // `isReadOnly()` — zoom mutates no store state (see options.isReadOnly doc + gantt.ts's
        // zoomIn()/zoomOut(), which are intentionally readOnly-independent). `preventDefault()`
        // is load-bearing here: Ctrl/Cmd+Plus/Minus are native browser page-zoom shortcuts in
        // every major browser — without it, the chart's zoom and the page's zoom would both
        // fire on the same keystroke.
        if (!(event.ctrlKey || event.metaKey)) return;
        event.preventDefault();
        options.onZoomIn();
        return;
      case '-':
        // Ctrl/Cmd + Minus (zoom out). `'-'` alone is sufficient — unlike `+`/`=`, the
        // unshifted main-row key already reports `'-'` directly on a US layout, and Numpad `-`
        // also reports `'-'` regardless of Shift. No `'_'` (Shift+`-`) case: no real-world
        // "Ctrl+Minus" keystroke pattern produces it, and adding it would widen the match
        // surface for no observed benefit (bundle-budget-conscious — see spec §1.5). Same
        // readOnly/preventDefault posture as the zoom-in arm above.
        if (!(event.ctrlKey || event.metaKey)) return;
        event.preventDefault();
        options.onZoomOut();
        return;
      default:
        return; // Enter unbound (v1), all other keys fall through untouched.
    }
  }

  /**
   * Delete/Backspace (spec §4.5 point 7 + §4.6): if the currently focused task is among the
   * selection about to be removed, pre-compute and apply the post-delete `focusedTaskId`
   * BEFORE calling `onDeleteSelected` — so that when the mutation's synchronous re-render
   * runs mid-callback, `getFocusedTaskId()` already reflects the clamped, post-delete target.
   */
  function handleDelete(rows: readonly RowLayout[]): void {
    const selection = new Set(options.getSelection());
    if (focusedTaskId !== undefined && selection.has(focusedTaskId)) {
      const remaining = rows.filter((r) => !selection.has(r.task.id));
      const removedIndex = rows.findIndex((r) => r.task.id === focusedTaskId);
      if (remaining.length === 0) {
        focusedTaskId = undefined;
        anchorTaskId = undefined;
      } else {
        // Count how many remaining rows sit before the removed row's original position, to
        // clamp to "the row now at the same position, or the new last row" (spec §4.6).
        const removedBefore = rows
          .slice(0, removedIndex === -1 ? rows.length : removedIndex)
          .filter((r) => !selection.has(r.task.id)).length;
        const clampedIndex = Math.min(removedBefore, remaining.length - 1);
        const next = remaining[clampedIndex]!.task.id;
        focusedTaskId = next;
        anchorTaskId = next;
      }
    }
    options.onDeleteSelected();
  }

  function handleArrow(
    event: KeyboardEvent,
    rows: readonly RowLayout[],
    currentIndex: number,
    direction: 1 | -1,
  ): void {
    // Stale/clamping case (spec §4.6): the previously focused task no longer resolves in a
    // fresh layoutRows() call. Clamp to the row at (or nearest to) the same position rather
    // than throwing or silently doing nothing.
    if (currentIndex === -1) {
      clampFocus(rows);
      return;
    }

    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= rows.length) return; // no wraparound (spec §4.4)

    const next = rows[nextIndex]!.task.id;
    event.preventDefault();

    if (event.shiftKey) {
      // Anchor UNCHANGED across a Shift-range sequence. The callback below triggers a
      // synchronous store mutation -> render effect -> full repaint; DOM focus restoration
      // to the (newly created) row matching `focusedTaskId` happens inside
      // svg-renderer.ts's render() itself (the `hadFocusInside` gate, spec §4.5), not here.
      focusedTaskId = next;
      const anchor = anchorTaskId ?? next;
      options.onRangeSelect(anchor, next);
    } else {
      focusedTaskId = next;
      anchorTaskId = next;
      options.onSelect(next);
    }
  }

  /** Clamps `focusedTaskId`/`anchorTaskId` to a valid row per spec §4.6: the row now at the
   *  same position, or the new last row if that position no longer exists. Empty grid →
   *  both become `undefined`. */
  function clampFocus(rows: readonly RowLayout[]): void {
    if (rows.length === 0) {
      focusedTaskId = undefined;
      anchorTaskId = undefined;
      return;
    }
    // No stable "previous row index" is available once the id itself no longer resolves —
    // clamp to the last row, the safe, always-valid fallback (spec §4.6's "new last row if
    // the removed row was last" case, applied generally since we don't know the previous
    // position once the id is gone).
    const last = rows[rows.length - 1]!.task.id;
    focusedTaskId = last;
    anchorTaskId = last;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    handle.svg.removeEventListener('keydown', onKeyDown);
  }
}
