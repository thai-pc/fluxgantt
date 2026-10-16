// Public prop/config/result types for @fluxgantt/react (spec-react-wrapper.md §2).
import type { CSSProperties, RefObject } from 'react';
import type { RenderCapability } from '@fluxgantt/core/render';
import type { ViewportCapability } from '@fluxgantt/core/viewport';
import type { ThemeCapability } from '@fluxgantt/core/theme';
import type {
  DateInput,
  Dependency,
  DependencyId,
  GanttConfig,
  GanttInstance,
  Task,
  TaskActivatedPayload,
  TaskContextRequestedPayload,
  TaskId,
} from '@fluxgantt/core';

/**
 * Config accepted by `useFluxGantt`. Extends `GanttConfig` as-is. Every field is
 * forwarded to `createGantt` (see `gantt-config.ts`). All are construction-time-only (resolution
 * #1) except `theme` (reactive via `setTheme`; defaults to `'light'` here, not core's `'auto'`)
 * and `onTaskChange` (always-latest). On top of `GanttConfig` it adds one discrete callback prop
 * per `GanttEventMap` event that exists on the facade today (resolution #4+#7).
 * `onTaskChange` is inherited unchanged from `GanttConfig` — it is the facade's own
 * "any field changed" catch-all, a different layer from the discrete events below; both
 * coexist (see `FluxGantt.tsx`).
 */
export interface UseFluxGanttConfig extends GanttConfig {
  readonly onTaskAdded?: (task: Task) => void;
  /** `prevStart` is `DateInput`, not a plain `Date` — matches `GanttEventMap['task:moved']`. */
  readonly onTaskMoved?: (task: Task, prevStart: DateInput) => void;
  readonly onTaskResized?: (task: Task, prevDuration: number) => void;
  readonly onTaskProgressed?: (task: Task, prevProgress: number) => void;
  readonly onTaskRemoved?: (taskId: TaskId) => void;
  readonly onDependencyAdded?: (dependency: Dependency) => void;
  readonly onDependencyRemoved?: (dependencyId: DependencyId) => void;
  readonly onCriticalPathComputed?: (criticalTaskIds: readonly TaskId[]) => void;
  /** Double-click, Enter on a leaf row, or F2 on a task. Fires in `readOnly` charts too: it means
   *  "the user asked to open this task", not "the task is editable". Read it with
   *  `instance.getTask(payload.taskId)`. */
  readonly onTaskActivated?: (payload: TaskActivatedPayload) => void;
  /** Right-click, ContextMenu / Shift+F10, or touch long-press on a task. Call
   *  `payload.preventDefault()` synchronously to suppress the native menu. Fires in `readOnly`
   *  charts too. */
  readonly onTaskContextRequested?: (payload: TaskContextRequestedPayload) => void;
}

export interface UseFluxGanttResult {
  /** Attach to the container element that should host the rendered chart. Stable identity
   *  across renders (from `useRef`). NOT the raw DOM node itself as a value — an object
   *  ref, per React's ref contract. */
  readonly ref: RefObject<HTMLDivElement | null>;
  /** The full `GanttInstance` (resolution #6 — no curated subset), plus `RenderCapability`
   *  (`mount`/`unmount`/`refresh`, from the opt-in `@fluxgantt/core/render` mixin) and
   *  `ViewportCapability` (`scrollToTask`/`scrollToDate`/`setDensity`, from the opt-in
   *  `@fluxgantt/core/viewport` mixin; the `density` prop stays construction-time) and
   *  `ThemeCapability` (`setTheme`/`getTheme`/`getResolvedTheme`, `@fluxgantt/core/theme`).
   *  The wrapper composes all of them for you (see `use-flux-gantt.ts`). In SVG mode the scroll methods need the
   *  container to be the scroll viewport: give it a bounded height and `overflow: auto`.
   *  Stable identity across renders (created once). */
  readonly instance: GanttInstance & RenderCapability & ViewportCapability & ThemeCapability;
}

export interface FluxGanttProps extends UseFluxGanttConfig {
  readonly className?: string;
  readonly style?: CSSProperties;
}

/** Type of the value `<FluxGantt ref={...}>` exposes via `useImperativeHandle`. */
export type FluxGanttRef = GanttInstance &
  RenderCapability &
  ViewportCapability &
  ThemeCapability;
