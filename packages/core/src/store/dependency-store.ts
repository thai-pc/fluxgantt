// DependencyStore — links between tasks (spec §5.1 State Layer, §7.3 Dependency Operations).
// Headless, reactive via signals. Prevents cycles at link time (CPM requires a DAG, §13.1/§20).
import { signal, type ReadonlySignal } from '../signals.js';
import {
  toDependencyId,
  type Dependency,
  type DependencyId,
  type DependencyType,
  type TaskId,
} from '../types.js';

export interface LinkOptions {
  lag?: number; // hours; negative = lead time
  /** Allow creating a link even if it introduces a cycle (default false → throw). */
  allowCycle?: boolean;
}

const newDependencyId = (): DependencyId => toDependencyId(`dep-${globalThis.crypto.randomUUID()}`);

export class DependencyStore {
  readonly #deps = new Map<DependencyId, Dependency>();
  readonly #rev = signal(0);

  constructor(initial?: readonly Dependency[]) {
    if (initial) {
      for (const d of initial) this.#deps.set(d.id, { ...d });
    }
  }

  /** Revision signal — read `.value` inside an effect/computed to track changes. */
  get revision(): ReadonlySignal<number> {
    return this.#rev;
  }

  #bump(): void {
    this.#rev.value++;
  }

  #track(): void {
    void this.#rev.value;
  }

  // --- Mutations -----------------------------------------------------------

  /** Create a `from → to` link. Throws on a self-link, a duplicate pair, or a cycle. */
  link(
    from: TaskId,
    to: TaskId,
    type: DependencyType = 'FS',
    options: LinkOptions = {},
  ): Dependency {
    if (from === to) {
      throw new Error(`DependencyStore.link: cannot self-link task ${from}`);
    }
    if (this.#findByPair(from, to)) {
      throw new Error(`DependencyStore.link: link ${from} → ${to} already exists`);
    }
    if (!options.allowCycle && this.#canReach(to, from)) {
      throw new Error(`DependencyStore.link: link ${from} → ${to} would create a cycle`);
    }
    const dep: Dependency = { id: newDependencyId(), from, to, type, lag: options.lag ?? 0 };
    this.#deps.set(dep.id, dep);
    this.#bump();
    return dep;
  }

  /** Remove the link(s) for a from/to pair (any type). */
  unlink(from: TaskId, to: TaskId): void {
    let removed = false;
    for (const [id, d] of this.#deps) {
      if (d.from === from && d.to === to) {
        this.#deps.delete(id);
        removed = true;
      }
    }
    if (removed) this.#bump();
  }

  remove(id: DependencyId): void {
    if (this.#deps.delete(id)) this.#bump();
  }

  /** Remove every link that references a task (called when a task is deleted). */
  removeForTask(taskId: TaskId): void {
    let removed = false;
    for (const [id, d] of this.#deps) {
      if (d.from === taskId || d.to === taskId) {
        this.#deps.delete(id);
        removed = true;
      }
    }
    if (removed) this.#bump();
  }

  clear(): void {
    if (this.#deps.size === 0) return;
    this.#deps.clear();
    this.#bump();
  }

  // --- Reads (reactive) ----------------------------------------------------

  get(id: DependencyId): Dependency | undefined {
    this.#track();
    return this.#deps.get(id);
  }

  get size(): number {
    this.#track();
    return this.#deps.size;
  }

  all(): Dependency[] {
    this.#track();
    return [...this.#deps.values()];
  }

  /** Every link touching a task (incoming or outgoing). */
  of(taskId: TaskId): Dependency[] {
    this.#track();
    return [...this.#deps.values()].filter((d) => d.from === taskId || d.to === taskId);
  }

  /** Links into a task (the task is `to`) — i.e. the task's predecessors. */
  predecessors(taskId: TaskId): Dependency[] {
    this.#track();
    return [...this.#deps.values()].filter((d) => d.to === taskId);
  }

  /** Links out of a task (the task is `from`) — i.e. the task's successors. */
  successors(taskId: TaskId): Dependency[] {
    this.#track();
    return [...this.#deps.values()].filter((d) => d.from === taskId);
  }

  linkExists(from: TaskId, to: TaskId): boolean {
    this.#track();
    return this.#findByPair(from, to) !== undefined;
  }

  /** Whether a `from → to` link would create a cycle (edge not yet added). */
  wouldCreateCycle(from: TaskId, to: TaskId): boolean {
    this.#track();
    return from === to || this.#canReach(to, from);
  }

  /** Whether the current graph has a cycle (3-color DFS). */
  hasCycle(): boolean {
    this.#track();
    const adj = this.#successorMap();
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;
    const color = new Map<TaskId, number>();
    const nodes = new Set<TaskId>();
    for (const d of this.#deps.values()) {
      nodes.add(d.from);
      nodes.add(d.to);
    }
    const visit = (n: TaskId): boolean => {
      color.set(n, GRAY);
      for (const m of adj.get(n) ?? []) {
        const c = color.get(m) ?? WHITE;
        if (c === GRAY) return true;
        if (c === WHITE && visit(m)) return true;
      }
      color.set(n, BLACK);
      return false;
    };
    for (const n of nodes) {
      if ((color.get(n) ?? WHITE) === WHITE && visit(n)) return true;
    }
    return false;
  }

  // --- Internal ------------------------------------------------------------

  #findByPair(from: TaskId, to: TaskId): Dependency | undefined {
    for (const d of this.#deps.values()) {
      if (d.from === from && d.to === to) return d;
    }
    return undefined;
  }

  #successorMap(): Map<TaskId, TaskId[]> {
    const map = new Map<TaskId, TaskId[]>();
    for (const d of this.#deps.values()) {
      const arr = map.get(d.from);
      if (arr) arr.push(d.to);
      else map.set(d.from, [d.to]);
    }
    return map;
  }

  /** Whether a path `start → ... → target` exists following from→to edges. */
  #canReach(start: TaskId, target: TaskId): boolean {
    const adj = this.#successorMap();
    const seen = new Set<TaskId>();
    const stack: TaskId[] = [start];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node === undefined) break;
      if (node === target) return true;
      if (seen.has(node)) continue;
      seen.add(node);
      for (const next of adj.get(node) ?? []) stack.push(next);
    }
    return false;
  }
}
