// Public prop/config/result types for @fluxgantt/react (spec-react-wrapper.md §2).
import type { CSSProperties, RefObject } from 'react';
import type {
  DateInput,
  Dependency,
  DependencyId,
  GanttConfig,
  GanttInstance,
  Task,
  TaskId,
} from '@fluxgantt/core';

/**
 * Config accepted by `useFluxGantt`. Extends `GanttConfig` as-is (resolution #1:
 * `tasks`/`dependencies`/`calendar`/`viewMode`/`density`/`locale`/`readOnly` are
 * construction-time-only — see `use-flux-gantt.ts`) and adds one discrete callback prop per
 * `GanttEventMap` event that exists on the facade today (resolution #4+#7).
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
}

export interface UseFluxGanttResult {
  /** Attach to the container element that should host the rendered chart. Stable identity
   *  across renders (from `useRef`). NOT the raw DOM node itself as a value — an object
   *  ref, per React's ref contract. */
  readonly ref: RefObject<HTMLDivElement | null>;
  /** The full `GanttInstance` (resolution #6 — no curated subset). Stable identity across
   *  renders (created once — see `use-flux-gantt.ts`). */
  readonly instance: GanttInstance;
}

export interface FluxGanttProps extends UseFluxGanttConfig {
  readonly className?: string;
  readonly style?: CSSProperties;
}

/** Type of the value `<FluxGantt ref={...}>` exposes via `useImperativeHandle`. */
export type FluxGanttRef = GanttInstance;
