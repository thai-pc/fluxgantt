// Opt-in schedule-conflict capability mixin (spec-detect-conflicts.md; spec §7.4
// `detectConflicts`, §7.9 `conflict:detected`).
//
//   import { createGantt } from '@fluxgantt/core';
//   import { withConflicts } from '@fluxgantt/core/conflicts';
//   const gantt = withConflicts(createGantt({ tasks, dependencies }));
//   gantt.detectConflicts();
//   gantt.on('conflict:detected', (conflicts) => { ... });
//
// WHY A MIXIN: class prototype methods never tree-shake, so a base-facade method would bill every
// consumer for the detector and the watcher. Headless: reads only the stores, the calendar and
// the config, never the mount state.
import type { GanttInstance } from '../gantt.js';
import { getInternal } from '../gantt-internal.js';
import { detectConflicts as detect } from '../compute/conflicts.js';
import { effect } from '../signals.js';
import type { Conflict, ConflictKind } from '../types.js';

export interface WithConflictsOptions {
  /** Which kinds to report. Default: all. `outside-parent` is dropped automatically when
   *  `GanttConfig.rollup` is set (the parent is DRAWN at its derived span, so an authored
   *  mismatch is not a visible contradiction).
   *
   *  Options apply on the first application only: `withConflicts` is idempotent, so a second call
   *  with different `kinds` logs a `console.warn` and keeps the first configuration.
   *
   *  Rollup caveat: `dependency-violation` always uses the AUTHORED start/end of a summary task
   *  (the same inputs `computeCascade` uses), even when `GanttConfig.rollup` makes the renderers
   *  draw that summary at its derived span. Under rollup, a dependency arrow that visibly runs
   *  backwards from/to a summary may therefore not be reported, and vice versa. */
  readonly kinds?: readonly ConflictKind[];
}

export interface ConflictsCapability {
  /**
   * Pure query over the live data: the current schedule conflicts in canonical order, as a fresh
   * array. Never emits. Returns `[]` after `destroy()`. Throws on non-finite / out-of-range
   * `duration` or `lag` (the caller gets the real error). The set is OPEN to additive growth in
   * minor releases: keep a default branch in any `switch (conflict.kind)`.
   *
   * Subscribe with `on('conflict:detected', cb)` for changes. The watcher runs only while at
   * least one such listener exists, is microtask-coalesced, emits only when the set changes
   * (`[]` when it clears), and does not emit on subscribe. Starting the watcher (the first
   * subscription) runs one full detection synchronously inside `on()`; afterwards every store
   * mutation, including `setProgress`, costs one detection per microtask turn.
   */
  detectConflicts(): Conflict[];
}

function signatureOf(conflicts: readonly Conflict[]): string {
  return conflicts
    .map((c) =>
      c.kind === 'dependency-violation'
        ? `d|${c.dependencyId}|${c.shortfallHours}|${c.requiredStart.epochNanoseconds}`
        : c.kind === 'outside-parent'
          ? `o|${c.taskId}|${c.parentId}|${c.edge}`
          : `i|${c.taskId}`,
    )
    .join('\n');
}

export function withConflicts<T extends GanttInstance>(
  instance: T,
  options?: WithConflictsOptions,
): T & ConflictsCapability {
  // Idempotent: StrictMode double effects, or a wrapper plus a host both applying it. Options
  // apply on the FIRST application only; a later call with different `kinds` warns (it cannot
  // throw: a second layer applying it is legitimate) and keeps the first configuration.
  const kindsKey = (options?.kinds ?? []).join(',');
  if ('detectConflicts' in instance) {
    const applied = (instance.detectConflicts as { kindsKey?: string }).kindsKey;
    if (applied !== undefined && applied !== kindsKey) {
      console.warn(
        `@fluxgantt/core: withConflicts() was already applied with kinds [${applied}]; ignoring kinds [${kindsKey}]`,
      );
    }
    return instance as T & ConflictsCapability;
  }

  const internal = getInternal(instance);
  const { tasks: taskStore, deps: dependencyStore, calendar, config } = internal;

  const compute = (): Conflict[] => {
    const kinds = (options?.kinds ?? ['invalid-span', 'dependency-violation', 'outside-parent']).filter(
      (k) => k !== 'outside-parent' || config.rollup === undefined,
    );
    return detect(taskStore.all(), dependencyStore.all(), calendar, { kinds });
  };

  const baseOn = instance.on.bind(instance);
  const baseDestroy = instance.destroy.bind(instance);
  let listeners = 0;
  let stop: (() => void) | undefined;

  const safeSignature = (): string | undefined => {
    try {
      return signatureOf(compute());
    } catch (error) {
      console.warn('@fluxgantt/core: detectConflicts failed while watching', error);
      return undefined;
    }
  };

  const startWatcher = (): void => {
    let last = safeSignature() ?? '';
    let scheduled = false;
    let first = true;
    const dispose = effect(() => {
      void taskStore.revision.value;
      void dependencyStore.revision.value;
      if (first) {
        first = false; // the baseline above is the silent initial state
        return;
      }
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (stop !== stopThis || internal.dead()) return;
        let conflicts: Conflict[];
        try {
          conflicts = compute();
        } catch (error) {
          console.warn('@fluxgantt/core: detectConflicts failed while watching', error);
          return;
        }
        const sig = signatureOf(conflicts);
        if (sig === last) return;
        last = sig;
        internal.emit('conflict:detected', conflicts);
      });
    });
    // Per-watcher token: a flush queued by a watcher that has since been stopped must not emit
    // through a watcher started later in the same tick (it holds a stale `last`).
    const stopThis = (): void => {
      if (stop === stopThis) stop = undefined;
      dispose();
    };
    stop = stopThis;
  };

  const detectConflicts = (): Conflict[] => (internal.dead() ? [] : compute());
  (detectConflicts as { kindsKey?: string }).kindsKey = kindsKey;
  const capability: ConflictsCapability = { detectConflicts };

  return Object.assign(instance, capability, {
    on(event: string, callback: never) {
      const off = baseOn(event as 'task:added', callback);
      if (event !== 'conflict:detected') return off;
      if (listeners++ === 0 && !internal.dead()) startWatcher();
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        off();
        if (--listeners === 0) stop?.();
      };
    },
    destroy(): void {
      stop?.();
      baseDestroy();
    },
  }) as T & ConflictsCapability;
}
