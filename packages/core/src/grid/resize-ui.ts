// Column resize, the LAZY half (see `resize.ts`): the pointer drag, the header key actions and the focus ring.
// Fetched by `resize.ts` / `canvas-grid.ts` through `env.ui()` on the first pointer-over a handle, the first
// header focus or the first drag/key; kept out of every size fixture like `canvas-grid.ts`. DOM-specific.
//
// SECURITY (security.md): only numbers and constants reach the DOM; ids are compared as attribute values.
import { announceGrid } from './announce.js';
import { HEADER_HEIGHT } from './fit.js';
import { focusHeader, type ResizeEnv } from './resize.js';

/** Keyboard step in px; Shift makes it fine. */
const STEP = 16;
const FINE_STEP = 2;

/**
 * Starts a pointer drag of column `id`'s inline-end edge from the pointerdown `start`. The listeners are on
 * `window` in the capture phase (not on the pressed element), so a repaint that replaces the sizer mid-drag
 * cannot orphan the drag. The width commits ONCE on release; Escape, pointercancel or another press cancels.
 * The guide is `position:fixed` on the container: inside a host ancestor with `transform`, `filter` or
 * `contain: paint` it is drawn offset (the commit is still correct).
 */
export function beginDrag(env: ResizeEnv, start: PointerEvent, id: string): void {
  const col = env.view().cols.find((c) => c.id === id);
  if (env.nav.stop || !col || col.minWidth === col.maxWidth) return; // one drag at a time
  // Growing is "toward the chart": rightward, or leftward when mirrored.
  const sign = env.mirrored() ? -1 : 1;
  const x0 = start.clientX;
  const widthAt = (x: number): number => Math.min(col.maxWidth, Math.max(col.minWidth, Math.round(col.width + sign * (x - x0))));
  const box = env.container.getBoundingClientRect();
  // A border, not a fill, so forced colors recolour it.
  const guide = document.createElement('div');
  guide.className = 'fg-grid__guide';
  guide.style.cssText = 'position:fixed;pointer-events:none;margin-left:-1px;border-left:2px solid var(--fg-task-focus,#0369a1)';
  guide.style.top = `${box.top}px`;
  guide.style.height = `${box.height}px`;
  let width = col.width;
  const place = (): void => {
    guide.style.left = `${x0 + sign * (width - col.width)}px`;
  };
  place();
  env.container.append(guide);
  const end = (commit: boolean): void => {
    for (const [t, f] of table) window.removeEventListener(t, f, true);
    env.nav.stop = undefined;
    guide.remove();
    if (commit && width !== col.width) env.resize(col.id, width);
  };
  const ours = (e: Event): boolean => (e as PointerEvent).pointerId === start.pointerId;
  const table: [string, (e: Event) => void][] = [
    [
      'pointermove',
      (e) => {
        if (!ours(e)) return;
        width = widthAt((e as PointerEvent).clientX);
        place();
      },
    ],
    [
      'pointerup',
      (e) => {
        if (!ours(e)) return;
        width = widthAt((e as PointerEvent).clientX);
        end(true);
      },
    ],
    ['pointercancel', () => end(false)],
    ['pointerdown', () => end(false)], // another press (a second finger; or the release was missed while loading)
    [
      'keydown',
      (e) => {
        if ((e as KeyboardEvent).key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        end(false);
      },
    ],
  ];
  env.nav.stop = () => end(false);
  for (const [t, f] of table) window.addEventListener(t, f, true);
}

/** Header mode keys that need the columns: Left/Right/Home/End between headers, Alt(+Shift)+Left/Right resize. */
export function onKey(env: ResizeEnv, e: KeyboardEvent, head: HTMLElement): void {
  const cols = env.view().cols;
  const i = Number(head.getAttribute('aria-colindex')) - 1;
  const c = cols[i];
  if (!c) return;
  const k = e.key;
  // LOGICAL direction: "right" is toward the chart, which is leftward when mirrored.
  const toward = (k === 'ArrowRight') === !env.mirrored();
  if (e.altKey) {
    const step = e.shiftKey ? FINE_STEP : STEP;
    env.resize(c.id, c.width + (toward ? step : -step));
    focusHeader(env); // a repaint replaced the header
    const width = env.view().cols[i]?.width ?? c.width;
    announceGrid(
      env.internal,
      { kind: 'column-resized', columnId: c.id, header: c.header, width, locale: env.internal.config.locale ?? 'en' },
      `${c.header}: ${width} pixels wide`,
    );
    return;
  }
  const j = k === 'Home' ? 0 : k === 'End' ? cols.length - 1 : i + (toward ? 1 : -1);
  env.nav.tab = Math.min(Math.max(j, 0), cols.length - 1);
  focusHeader(env);
}

/** The SVG focus frame over the focused header (the real header is invisible live; Canvas paints its own). */
export function ring(env: ResizeEnv): void {
  const { container, nav } = env;
  container.querySelector('.fg-grid__ring')?.remove();
  const ov = container.querySelector<HTMLElement>('.fg-grid__ov');
  const v = env.view();
  const col = v.cols[nav.tab];
  const active = document.activeElement;
  if (!ov || !col || active?.getAttribute('role') !== 'columnheader' || !container.contains(active)) return;
  const r = document.createElement('div');
  r.className = 'fg-grid__ring';
  r.style.cssText =
    'position:absolute;top:0;box-sizing:border-box;pointer-events:none;border:2px solid var(--fg-task-focus,#0369a1)';
  r.style.insetInlineStart = `${v.offs[nav.tab]}px`;
  r.style.width = `${col.width}px`;
  r.style.height = `${HEADER_HEIGHT}px`;
  ov.append(r);
}
