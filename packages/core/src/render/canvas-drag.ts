// Canvas-mode drag (move, resize, create dependency) — spec-canvas-drag.md. Lives in the lazy Canvas
// chunk: it is statically imported by `canvas-renderer.ts` only, so it costs 0 B in every
// fixture. The three recognizers register on the SAME `pointer-drag.ts` coordinator the SVG path
// uses (threshold, Escape, pointercancel, second-pointer guard, destroy-mid-drag all inherited);
// only hit-testing and the preview differ, because Canvas has no per-bar DOM.
//
// The preview is a SEPARATE viewport-sized overlay `<canvas>` (sticky, `pointer-events: none`).
// The main canvas is never repainted during a gesture: an original bar stays painted and a
// translucent ghost moves on the overlay. Cost per frame is independent of task count.
//
// SECURITY: pointer coordinates are untrusted numbers (the coordinator filters non-finite ones
// and `snapDeltaToDay` clamps the delta). Task identity comes from the laid-out rows, never from
// DOM text. Task colour only reaches the overlay through the shared `paintTaskBar`
// (`validateTaskColor`). No `innerHTML`, no `fillText`, no inline `<style>`.
//
// Must NOT import `interaction/*` at runtime (type-only imports are erased): pure drag math lives
// in `internal/drag-math.ts`.
import type { Temporal } from '@js-temporal/polyfill';
import type { PointerDragController, PointerGestureRecognizer } from '../interaction/pointer-drag.js';
import {
  COARSE_EDGE_HIT_ZONE_PX,
  COARSE_LINK_HANDLE_RADIUS_PX,
  DEFAULT_DRAG_THRESHOLD_PX,
  EDGE_HIT_ZONE_PX,
  LINK_HANDLE_RADIUS_PX,
  computeClampedResizedEnd,
  computeDraggedDates,
  snapDeltaToDay,
} from '../internal/drag-math.js';
import type { Task, TaskId } from '../types.js';
import type { BarHit, BarZone } from './interactive-renderer-handle.js';
import {
  anchorOf,
  layoutTaskBar,
  type RolledUpRow,
  type RowLayout,
  type TaskBarLayout,
  type TimeScale,
} from './renderer-base.js';

/** Same value as `canvas-renderer.ts`'s `HEADER_HEIGHT` (passed in by the host: no import cycle). */
export interface DragView {
  /** Identity of the renderer's `RenderState`; replaced by `update()`/`setOptions()`, kept by scroll. */
  readonly key: object;
  readonly rows: readonly RowLayout[];
  readonly rowHeight: number;
  readonly timeScale: TimeScale;
  readonly offsetX: number;
  readonly rollup: ReadonlyMap<TaskId, RolledUpRow> | undefined;
  readonly selected: ReadonlySet<TaskId>;
  readonly critical: ReadonlySet<TaskId>;
}

export interface DragTokens {
  readonly depLine: string;
  readonly taskSelected: string;
}

export interface CanvasDragHost {
  readonly canvas: HTMLCanvasElement;
  readonly container: HTMLElement;
  readonly headerHeight: number;
  view(): DragView;
  selectedCount(): number;
  viewportHeight(): number;
  tokens(): DragTokens;
  /** The renderer's own bar painter, injected so ghosts match painted bars exactly. */
  paintBar(
    ctx: CanvasRenderingContext2D,
    task: Task,
    bar: TaskBarLayout,
    offsetX: number,
    offsetY: number,
    isCritical: boolean,
    isSelected: boolean,
    rolled: RolledUpRow | undefined,
  ): void;
}

export interface CanvasDragCallbacks {
  readonly onTaskMoved: (id: TaskId, start: Temporal.ZonedDateTime, end: Temporal.ZonedDateTime) => void;
  readonly onTaskResized: (id: TaskId, end: Temporal.ZonedDateTime) => void;
  /** Absent when `enableDependencyDrag === false`: no link zone, no handles, no crosshair. */
  readonly onDependencyCreated?: ((from: TaskId, to: TaskId) => void) | undefined;
}

export interface CanvasDrag {
  hitTestBar(clientX: number, clientY: number, pointerType?: string): BarHit | undefined;
  /** Re-sync after every successful main render. */
  onRender(): void;
  dispose(): void;
}

/** Geometry of one row's bar in canvas-local CSS px (header band included, scroll applied). */
interface Geometry {
  readonly row: RowLayout;
  readonly bar: TaskBarLayout;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly midY: number;
  readonly milestone: boolean;
  readonly rolledUp: boolean;
}

/** Row under canvas-local `y`, with its bar geometry; `undefined` outside the row band/rows. */
export function locateRow(
  host: Pick<CanvasDragHost, 'headerHeight' | 'container'>,
  view: DragView,
  y: number,
): Geometry | undefined {
  const scrollTop = host.container.scrollTop;
  const row = view.rows[Math.floor((y - host.headerHeight + scrollTop) / view.rowHeight)];
  if (row === undefined) return undefined;
  const bar = layoutTaskBar(row.task, view.timeScale, row, view.rowHeight, view.rollup);
  const left = view.offsetX + bar.x;
  const top = host.headerHeight + bar.y - scrollTop;
  const milestone = row.task.type === 'milestone';
  return {
    row,
    bar,
    left,
    right: left + bar.width,
    top,
    midY: top + bar.height / 2,
    milestone,
    rolledUp: !milestone && view.rollup?.has(row.task.id) === true,
  };
}

/** Whether canvas-local `(x, y)` is inside the bar rect, or a milestone's 45-degree diamond. */
export function insideBar(g: Geometry, x: number, y: number): boolean {
  if (g.milestone) {
    // The painted square is rotated 45 degrees: a diamond with half-diagonal size * sqrt(1/2).
    return (
      Math.abs(x - (g.left + g.bar.width / 2)) + Math.abs(y - g.midY) <= g.bar.width * Math.SQRT1_2
    );
  }
  return x >= g.left && x <= g.right && y >= g.top && y <= g.top + g.bar.height;
}

interface Located extends BarHit {
  readonly geometry: Geometry;
}

interface GestureBase {
  /** `RenderState` identity at claim time: a different one later means the chart was re-rendered
   *  from new data/options, i.e. this gesture is stale (SVG parity with its `isConnected` abort). */
  readonly key: object;
  readonly task: Task;
  readonly bar: TaskBarLayout;
  readonly rolled: RolledUpRow | undefined;
  readonly critical: boolean;
}

interface LinkState extends GestureBase {
  readonly end: 'start' | 'end';
}

type Preview =
  | { readonly kind: 'move'; readonly st: GestureBase; readonly dxPx: number }
  | { readonly kind: 'resize'; readonly st: GestureBase; readonly width: number }
  | {
      readonly kind: 'link';
      readonly st: LinkState;
      readonly x: number;
      readonly y: number;
      readonly target: TaskBarLayout | undefined;
    };

/** Put on the canvas (the gesture's `grp`) by the coordinator for the life of a started drag. */
const DRAGGING_CLASS = 'fg-timeline-canvas--dragging';
const GHOST_ALPHA = 0.85;
const ARROW_PX = 6;
const BODY_CURSORS: Record<BarZone, string> = {
  'link-start': 'crosshair',
  'link-end': 'crosshair',
  'resize-end': 'ew-resize',
  body: 'grab',
};

export function createCanvasDrag(
  host: CanvasDragHost,
  controller: PointerDragController,
  wiring: CanvasDragCallbacks,
): CanvasDrag {
  const { canvas, container } = host;
  const linkEnabled = wiring.onDependencyCreated !== undefined;
  // Resolved ONCE (same posture as drag-resize.ts); the coarse zones are a strict superset.
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const edgeZone = coarse ? COARSE_EDGE_HIT_ZONE_PX : EDGE_HIT_ZONE_PX;
  const handleRadius = coarse ? COARSE_LINK_HANDLE_RADIUS_PX : LINK_HANDLE_RADIUS_PX;

  let attached = true;
  let overlay: HTMLCanvasElement | undefined;
  let octx: CanvasRenderingContext2D | null = null;
  let preview: Preview | undefined;
  let gestureActive = false;
  let hoverId: TaskId | undefined;
  let lastPointer: { x: number; y: number } | undefined;
  let frame: number | undefined;
  let handleStyle: readonly [string, string, number] | undefined;

  const clientToLocal = (clientX: number, clientY: number): { x: number; y: number } | undefined => {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return undefined;
    const rect = canvas.getBoundingClientRect();
    // The canvas is the full content width: bound by the scroll container's VISIBLE box too (scrollbars
    // excluded), so a drop on page chrome or outside the chart resolves nothing, as in SVG.
    const box = container.getBoundingClientRect();
    const visLeft = box.left + container.clientLeft;
    if (
      clientX < visLeft ||
      clientX > visLeft + container.clientWidth ||
      clientY > box.top + container.clientTop + container.clientHeight
    ) {
      return undefined;
    }
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    return x < 0 || x > rect.width || y < host.headerHeight || y > rect.height ? undefined : { x, y };
  };

  /**
   * `any`: ignore the link-handle zones and the rolled-up gate (a summary bar is a valid drop
   * target and hover subject). Otherwise: exactly what a drag recognizer would claim.
   */
  const locate = (clientX: number, clientY: number, pointerType: string | undefined, any: boolean): Located | undefined => {
    if (!attached) return undefined;
    const p = clientToLocal(clientX, clientY);
    if (!p) return undefined;
    const view = host.view();
    const g = locateRow(host, view, p.y);
    if (!g) return undefined;
    const id = g.row.task.id;
    const hit = (zone: BarZone): Located => ({ taskId: id, zone, geometry: g });
    if (!any && linkEnabled && (pointerType !== 'touch' || view.selected.has(id))) {
      if (Math.hypot(p.x - g.left, p.y - g.midY) <= handleRadius) return hit('link-start');
      if (Math.hypot(p.x - g.right, p.y - g.midY) <= handleRadius) return hit('link-end');
    }
    if (!insideBar(g, p.x, p.y) || (g.rolledUp && !any)) return undefined;
    return hit(!g.milestone && g.bar.width >= edgeZone && p.x >= g.right - edgeZone ? 'resize-end' : 'body');
  };

  // --- Overlay -----------------------------------------------------------------------------

  const ensureOverlay = (): CanvasRenderingContext2D | null => {
    if (!overlay) {
      overlay = document.createElement('canvas');
      overlay.className = 'fg-timeline-canvas-overlay';
      overlay.setAttribute('aria-hidden', 'true');
      const s = overlay.style;
      s.position = 'sticky';
      s.top = '0';
      s.left = '0';
      s.pointerEvents = 'none';
      s.display = 'block';
      container.insertBefore(overlay, canvas.nextSibling);
      octx = overlay.getContext('2d');
    }
    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = host.viewportHeight();
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    // Written only on a real change: assigning width/height reallocates and clears the bitmap.
    if (overlay.width !== pw) overlay.width = pw;
    if (overlay.height !== ph) overlay.height = ph;
    overlay.style.width = `${w}px`;
    overlay.style.height = `${h}px`;
    overlay.style.marginTop = `-${h}px`;
    return octx;
  };

  // Same tokens and defaults as the SVG handle circles; read once per render, not per frame.
  const readHandleStyle = (): readonly [string, string, number] => {
    if (!handleStyle) {
      const css = getComputedStyle(container);
      const read = (n: string): string => css.getPropertyValue(n).trim();
      const w = Number.parseFloat(read('--fg-link-handle-stroke-width'));
      handleStyle = [read('--fg-link-handle-fill') || '#ffffff', read('--fg-link-handle-stroke') || '#6366f1', w > 0 ? w : 1.5];
    }
    return handleStyle;
  };

  const paint = (): void => {
    // Nothing to draw and nothing to clear: skip the (O(rows) on a new state) layout entirely.
    if (!preview && !overlay && hoverId === undefined && host.selectedCount() === 0) return;
    const view = host.view();
    const scrollTop = container.scrollTop;
    const rowH = view.rowHeight;
    // Handles: hovered bar, plus selected bars in the visible row window. None mid-gesture.
    const handles: Geometry[] = [];
    if (linkEnabled && !preview && !gestureActive) {
      const from = Math.max(0, Math.floor(scrollTop / rowH));
      const to = Math.min(view.rows.length - 1, Math.ceil((scrollTop + host.viewportHeight()) / rowH));
      for (let i = from; i <= to; i++) {
        const id = view.rows[i]!.task.id;
        if (id === hoverId || view.selected.has(id)) {
          const g = locateRow(host, view, host.headerHeight + i * rowH - scrollTop + rowH / 2);
          if (g) handles.push(g);
        }
      }
    }
    if (!preview && handles.length === 0 && !overlay) return;
    const ctx = ensureOverlay();
    if (!ctx || !overlay) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (!preview && handles.length === 0) return;
    // Paint in MAIN-canvas-local coordinates: translate by where the main canvas sits relative to
    // the overlay, so scroll offsets, padding and the sub-pixel inline-baseline gap cannot skew it.
    const cr = canvas.getBoundingClientRect();
    const or = overlay.getBoundingClientRect();
    ctx.setTransform(dpr, 0, 0, dpr, (cr.left - or.left) * dpr, (cr.top - or.top) * dpr);
    ctx.save();
    try {
      // Never paint over the pinned header band.
      ctx.beginPath();
      ctx.rect(0, host.headerHeight, cr.width, host.viewportHeight() - host.headerHeight);
      ctx.clip();
      const offsetY = host.headerHeight - scrollTop;
      if (preview) paintPreview(ctx, view, preview, offsetY);
      for (const g of handles) paintHandles(ctx, g);
    } finally {
      ctx.restore();
    }
  };

  const paintHandles = (ctx: CanvasRenderingContext2D, g: Geometry): void => {
    ctx.save();
    const [fill, stroke, width] = readHandleStyle();
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.setLineDash([]);
    for (const x of [g.left, g.right]) {
      ctx.beginPath();
      ctx.arc(x, g.midY, handleRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  };

  const paintPreview = (ctx: CanvasRenderingContext2D, view: DragView, pv: Preview, offsetY: number): void => {
    const { st } = pv;
    if (pv.kind !== 'link') {
      const bar: TaskBarLayout =
        pv.kind === 'move'
          ? { ...st.bar, x: st.bar.x + pv.dxPx }
          : { ...st.bar, width: pv.width };
      ctx.globalAlpha = GHOST_ALPHA;
      host.paintBar(ctx, st.task, bar, view.offsetX, offsetY, st.critical, true, st.rolled);
      return;
    }
    const tokens = host.tokens();
    const a = anchorOf(st.bar, pv.st.end);
    const ox = view.offsetX + a.x;
    const oy = a.y + offsetY;
    if (pv.target) {
      const t = pv.target;
      ctx.save();
      ctx.strokeStyle = tokens.taskSelected;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.strokeRect(view.offsetX + t.x - 1, t.y + offsetY - 1, t.width + 2, t.height + 2);
      ctx.restore();
    }
    ctx.save();
    ctx.strokeStyle = tokens.depLine;
    ctx.fillStyle = tokens.depLine;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(pv.x, pv.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // Arrowhead along the (generally diagonal) segment.
    const ang = Math.atan2(pv.y - oy, pv.x - ox);
    ctx.beginPath();
    ctx.moveTo(pv.x, pv.y);
    for (const d of [Math.PI - 0.45, Math.PI + 0.45]) {
      ctx.lineTo(pv.x + ARROW_PX * Math.cos(ang + d), pv.y + ARROW_PX * Math.sin(ang + d));
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  // --- Hover / cursor ----------------------------------------------------------------------

  const resolveHover = (): void => {
    const hit = !gestureActive && lastPointer ? locate(lastPointer.x, lastPointer.y, 'mouse', true) : undefined;
    // Cursor follows what a press would CLAIM (a rolled-up body is inert, so no `grab`).
    const claim = !gestureActive && lastPointer ? locate(lastPointer.x, lastPointer.y, 'mouse', false) : undefined;
    // A link handle's outer half sits outside the bar rect: keep the bar hovered while it is claimable.
    hoverId = (hit ?? claim)?.taskId;
    canvas.style.cursor = claim ? BODY_CURSORS[claim.zone] : '';
  };

  const refresh = (): void => {
    frame = undefined;
    resolveHover();
    paint();
  };
  const schedule = (): void => {
    frame ??= requestAnimationFrame(refresh);
  };

  const onHoverMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return;
    // Always track the pointer, so the refresh after a drop resolves at the RELEASE position.
    lastPointer = { x: e.clientX, y: e.clientY };
    if (e.buttons === 0 && !gestureActive) schedule();
  };
  const onLeave = (): void => {
    lastPointer = undefined;
    schedule();
  };
  canvas.addEventListener('pointermove', onHoverMove, { passive: true });
  canvas.addEventListener('pointerleave', onLeave);

  // --- Recognizers -------------------------------------------------------------------------

  const claim = (event: PointerEvent, ...zones: BarZone[]): Located | undefined => {
    const hit = locate(event.clientX, event.clientY, event.pointerType, false);
    return hit && zones.includes(hit.zone) ? hit : undefined;
  };
  const base = (hit: Located): GestureBase => {
    const view = host.view();
    const id = hit.taskId;
    return {
      key: view.key,
      task: hit.geometry.row.task,
      bar: hit.geometry.bar,
      rolled: view.rollup?.get(id),
      critical: view.critical.has(id),
    };
  };
  /** The gesture started on a render that has since been replaced by an `update()`. */
  const stale = (st: GestureBase): boolean => st.key !== host.view().key;
  const begin = (): void => {
    gestureActive = true;
    canvas.style.cursor = '';
    hoverId = undefined;
    paint();
  };
  const finish = (): void => {
    gestureActive = false;
    preview = undefined;
    paint();
  };

  const move: PointerGestureRecognizer<GestureBase> = {
    cls: DRAGGING_CLASS,
    cursor: 'grabbing',
    priority: 10,
    slop: DEFAULT_DRAG_THRESHOLD_PX,
    claim: (event) => {
      const hit = claim(event, 'body', 'resize-end');
      return hit ? base(hit) : null;
    },
    start: () => begin(),
    move(ctx, dx) {
      if (stale(ctx.state)) return;
      preview = { kind: 'move', st: ctx.state, dxPx: snapDeltaToDay(dx, ctx.ts) * ctx.ts.pixelsPerDay };
      schedule();
    },
    commit(ctx, dx) {
      finish();
      if (stale(ctx.state)) return;
      const { task } = ctx.state;
      const { newStart, newEnd } = computeDraggedDates(ctx.ts, task.start, task.end, snapDeltaToDay(dx, ctx.ts));
      wiring.onTaskMoved(task.id, newStart, newEnd);
    },
    cancel: finish,
  };

  const resize: PointerGestureRecognizer<GestureBase> = {
    cls: DRAGGING_CLASS,
    cursor: 'ew-resize',
    priority: 0,
    slop: DEFAULT_DRAG_THRESHOLD_PX,
    claim: (event) => {
      const hit = claim(event, 'resize-end');
      return hit ? base(hit) : null;
    },
    start: () => begin(),
    move(ctx, dx) {
      if (stale(ctx.state)) return;
      const { task } = ctx.state;
      const newEnd = computeClampedResizedEnd(ctx.ts, task.start, task.end, snapDeltaToDay(dx, ctx.ts));
      const width = Math.max(0, ctx.ts.dateToX(newEnd) - ctx.ts.dateToX(task.start));
      preview = { kind: 'resize', st: ctx.state, width };
      schedule();
    },
    commit(ctx, dx) {
      finish();
      if (stale(ctx.state)) return;
      const { task } = ctx.state;
      wiring.onTaskResized(
        task.id,
        computeClampedResizedEnd(ctx.ts, task.start, task.end, snapDeltaToDay(dx, ctx.ts)),
      );
    },
    cancel: finish,
  };

  const dropTarget = (event: PointerEvent, from: TaskId): Located | undefined => {
    const hit = locate(event.clientX, event.clientY, 'mouse', true);
    return hit && hit.taskId !== from ? hit : undefined;
  };

  const link: PointerGestureRecognizer<LinkState> = {
    cls: DRAGGING_CLASS,
    cursor: 'crosshair',
    priority: -10,
    slop: DEFAULT_DRAG_THRESHOLD_PX,
    claim: (event) => {
      const hit = claim(event, 'link-start', 'link-end');
      return hit ? { ...base(hit), end: hit.zone === 'link-start' ? 'start' : 'end' } : null;
    },
    start: () => begin(),
    move(ctx, _dx, event) {
      if (stale(ctx.state)) return;
      const rect = canvas.getBoundingClientRect();
      const t = dropTarget(event, ctx.state.task.id)?.geometry.bar;
      preview = {
        kind: 'link',
        st: ctx.state,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        target: t,
      };
      schedule();
    },
    commit(ctx, _dx, event) {
      finish();
      if (stale(ctx.state)) return;
      const drop = dropTarget(event, ctx.state.task.id);
      if (!drop) return;
      const from = ctx.state.task.id;
      // FS = predecessor finish -> successor start: the START handle makes the owner the successor.
      if (ctx.state.end === 'start') wiring.onDependencyCreated?.(drop.taskId, from);
      else wiring.onDependencyCreated?.(from, drop.taskId);
    },
    cancel: finish,
  };

  const disposers = [controller.register(resize), controller.register(move)];
  if (linkEnabled) disposers.push(controller.register(link));

  return {
    hitTestBar(clientX, clientY, pointerType) {
      const hit = locate(clientX, clientY, pointerType, false);
      return hit ? { taskId: hit.taskId, zone: hit.zone } : undefined;
    },
    onRender() {
      handleStyle = undefined;
      if (preview && stale(preview.st)) preview = undefined;
      refresh();
    },
    dispose() {
      if (!attached) return;
      attached = false;
      for (const d of disposers) d();
      canvas.removeEventListener('pointermove', onHoverMove);
      canvas.removeEventListener('pointerleave', onLeave);
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      canvas.style.cursor = '';
      overlay?.remove();
      overlay = undefined;
      octx = null;
    },
  };
}
