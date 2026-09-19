// CollapseStore — reactive UI-only hierarchy collapse/expand state (spec-collapse-expand.md
// §2/§3.1). Headless: pure Set<TaskId> + a revision signal, no DOM, no hierarchy knowledge
// (whether a given id actually HAS children — and is therefore collapsible at all — is a
// Gantt-facade concern, resolved via TaskStore.children(), mirrors how SelectionStore has no
// parent/child knowledge either).
//
// Lives in the BASE bundle (not behind `withRender`): `GanttConfig.initialCollapsed` must work
// headless, at construction time, independent of whether `withRender` is ever applied.
import { signal, type ReadonlySignal } from '../signals.js';
import type { TaskId } from '../types.js';
import { setsEqual } from './selection-store.js';

export class CollapseStore {
  readonly #ids = new Set<TaskId>();
  readonly #rev = signal(0);

  get revision(): ReadonlySignal<number> {
    return this.#rev;
  }

  /**
   * Replace the whole collapsed-id set. Returns `true` iff the resulting set differs from the
   * previous one (order-independent content compare) — callers (Gantt facade) use the return
   * value to decide whether to emit `collapse:changed`.
   */
  replace(ids: readonly TaskId[]): boolean {
    const next = new Set(ids);
    if (setsEqual(this.#ids, next)) return false;
    this.#ids.clear();
    for (const id of next) this.#ids.add(id);
    this.#rev.value++;
    return true;
  }

  /** Removes a single id. Returns `true` iff it was actually present (i.e. state changed) —
   *  used by `removeTask()`'s pruning of stale ids referencing a now-gone task. */
  delete(id: TaskId): boolean {
    if (!this.#ids.has(id)) return false;
    this.#ids.delete(id);
    this.#rev.value++;
    return true;
  }

  has(id: TaskId): boolean {
    void this.#rev.value; // reactive tracking read — same pattern as SelectionStore
    return this.#ids.has(id);
  }

  get size(): number {
    void this.#rev.value;
    return this.#ids.size;
  }

  all(): readonly TaskId[] {
    void this.#rev.value;
    return [...this.#ids];
  }
}
