// SelectionStore — reactive UI-only selection state (spec-selection.md §2). Headless: pure
// Set<TaskId> + a revision signal, no DOM, no hierarchy knowledge (parent/child expansion is
// a Gantt-facade concern, mirrors how removeTask's cascade lives in gantt.ts, not TaskStore).
import { signal, type ReadonlySignal } from '../signals.js';
import type { TaskId } from '../types.js';

export class SelectionStore {
  readonly #ids = new Set<TaskId>();
  readonly #rev = signal(0);

  get revision(): ReadonlySignal<number> {
    return this.#rev;
  }

  /**
   * Replace the whole selection. Returns `true` iff the resulting set differs from the
   * previous one (order-independent content compare) — callers (Gantt facade) use the
   * return value to decide whether to emit `selection:changed`; the reactive render effect
   * only re-runs when this bumps `revision`, so a true no-op replace triggers neither an
   * event nor a repaint.
   */
  replace(ids: readonly TaskId[]): boolean {
    const next = new Set(ids);
    if (setsEqual(next, this.#ids)) return false;
    this.#ids.clear();
    for (const id of next) this.#ids.add(id);
    this.#rev.value++;
    return true;
  }

  has(id: TaskId): boolean {
    void this.#rev.value;
    return this.#ids.has(id);
  }

  get size(): number {
    void this.#rev.value;
    return this.#ids.size;
  }

  all(): TaskId[] {
    void this.#rev.value;
    return [...this.#ids];
  }
}

function setsEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
