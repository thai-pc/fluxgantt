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

/** Thrown by {@link DependencyStore.link} for the three EXPECTED validation rejections —
 *  self-link, duplicate pair, cycle. A distinct type (not a bare `Error`) so callers that
 *  intentionally tolerate a rejected link (e.g. drag-create-dependency's silent revert) can
 *  catch ONLY this and let unrelated/programming errors propagate instead of swallowing them. */
export class DependencyLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DependencyLinkError';
  }
}

const newDependencyId = (): DependencyId => toDependencyId(`dep-${globalThis.crypto.randomUUID()}`);

export class DependencyStore {
  readonly #deps = new Map<DependencyId, Dependency>();
  // from -> to -> dependency, and to -> from -> dependency. At most one dependency per pair.
  readonly #out = new Map<TaskId, Map<TaskId, Dependency>>();
  readonly #in = new Map<TaskId, Map<TaskId, Dependency>>();
  // Insertion counter per dependency, so of() keeps global insertion order.
  readonly #seq = new Map<DependencyId, number>();
  #n = 0;
  readonly #rev = signal(0);

  constructor(initial?: readonly Dependency[]) {
    if (initial) {
      for (const d of initial) this.#put({ ...d });
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
    this.#reject(from, to);
    if (!options.allowCycle && this.#canReach(to, from)) {
      throw new DependencyLinkError(`DependencyStore.link: link ${from} → ${to} would create a cycle`);
    }
    const dep: Dependency = { id: newDependencyId(), from, to, type, lag: options.lag ?? 0 };
    this.#put(dep);
    this.#bump();
    return dep;
  }

  /**
   * Bulk `link()` for loading a whole dataset (constructor, import staging), all-or-nothing and
   * linear: one pass checks self-links and duplicate pairs, then ONE Kahn pass checks for cycles
   * (O(V + E) total, independent of edge order). Throws the same {@link DependencyLinkError}
   * class as sequential `link()`; for input that is invalid in more than one way the message may
   * name a different edge (a self-link or duplicate anywhere is reported before a cycle, and a
   * cycle is reported as the first input edge whose endpoints are both on or downstream of it).
   * On a throw nothing is added. Does not honour `allowCycle`.
   *
   * Precondition: the store is acyclic before the call (`Gantt` always guarantees it: it loads
   * into a fresh store). The cycle check covers the whole graph, so on a store that already holds
   * a cycle (made with `link(..., { allowCycle: true })`) every call is rejected, whatever it adds.
   *
   * @internal Loader plumbing, not part of the stable API.
   */
  linkAll(
    inputs: readonly { from: TaskId; to: TaskId; type?: DependencyType; lag?: number }[],
  ): Dependency[] {
    const made: Dependency[] = [];
    try {
      for (const { from, to, type, lag } of inputs) {
        this.#reject(from, to);
        const dep: Dependency = { id: newDependencyId(), from, to, type: type ?? 'FS', lag: lag ?? 0 };
        this.#put(dep);
        made.push(dep);
      }
      const stuck = this.#cyclic();
      if (stuck.size > 0) {
        // Name an edge that really lies on a cycle: walk back through stuck predecessors until a
        // node repeats (every stuck node has one), keep the repeating part, and take the LAST
        // input edge inside it, which is the edge sequential link() would have rejected. Linear,
        // error path only. (Both ends on one cycle means the edge closes a cycle.)
        const seen = new Set<TaskId>();
        let n: TaskId | undefined = stuck.values().next().value;
        while (n !== undefined && !seen.has(n)) {
          seen.add(n);
          n = [...this.#in.get(n)!.keys()].find((p) => stuck.has(p));
        }
        const cycle = new Set<TaskId>(); // the repeating tail of the walk, starting at n
        for (let m = n; m !== undefined && !cycle.has(m); m = [...this.#in.get(m)!.keys()].find((p) => stuck.has(p))) cycle.add(m);
        let bad = inputs[0]!;
        for (const d of inputs) if (cycle.has(d.from) && cycle.has(d.to)) bad = d;
        throw new DependencyLinkError(
          `DependencyStore.link: link ${bad.from} → ${bad.to} would create a cycle`,
        );
      }
    } catch (e) {
      for (const d of made) this.#drop(d);
      throw e;
    }
    if (made.length > 0) this.#bump();
    return made;
  }

  /**
   * History-replay support (undo/redo, gantt.ts). Inserts the EXACT `Dependency` object verbatim
   * — id preserved, no `newDependencyId()` call — skipping self-link/duplicate-pair/cycle
   * validation entirely. This resolves the identity gap `link()` has: `link()` has no way to
   * accept an explicit id (always synthesizes one), so undoing an `unlinkTasks()` — or redoing a
   * `linkTasks()` — could not otherwise round-trip the original `DependencyId`, which matters
   * because a host may hold onto that id (e.g. from `getDependenciesOf()` or the
   * `dependency:added` event payload).
   *
   * Skipping validation is safe SPECIFICALLY in the undo/redo context (not a general-purpose
   * "trust me" escape hatch): a replay only ever reconstructs a graph state the store was
   * ALREADY validly in at the exact moment of the original mutation.
   *
   * Caller contract: the pair must be free (or held by this same id), and restoring an id that is
   * already stored must keep its endpoints. A second dependency on an occupied pair is kept (as
   * before the pair indices existed) but the pair lookups (`linkExists`, `unlink`, `of`, ...) only
   * see the latest one.
   */
  restore(dependency: Dependency): Dependency {
    this.#put(dependency);
    this.#bump();
    return dependency;
  }

  /** Remove the link(s) for a from/to pair (any type). */
  unlink(from: TaskId, to: TaskId): void {
    const dep = this.#out.get(from)?.get(to);
    if (dep) {
      this.#drop(dep);
      this.#bump();
    }
  }

  remove(id: DependencyId): void {
    const dep = this.#deps.get(id);
    if (dep) {
      this.#drop(dep);
      this.#bump();
    }
  }

  /** Remove every link that references a task (called when a task is deleted). */
  removeForTask(taskId: TaskId): void {
    const touching = this.#touching(taskId);
    for (const d of touching) this.#drop(d);
    if (touching.size > 0) this.#bump();
  }

  clear(): void {
    if (this.#deps.size === 0) return;
    this.#deps.clear();
    this.#out.clear();
    this.#in.clear();
    this.#seq.clear();
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
    return [...this.#touching(taskId)].sort((a, b) => this.#seq.get(a.id)! - this.#seq.get(b.id)!);
  }

  /** Links into a task (the task is `to`) — i.e. the task's predecessors. */
  predecessors(taskId: TaskId): Dependency[] {
    this.#track();
    return [...(this.#in.get(taskId)?.values() ?? [])];
  }

  /** Links out of a task (the task is `from`) — i.e. the task's successors. */
  successors(taskId: TaskId): Dependency[] {
    this.#track();
    return [...(this.#out.get(taskId)?.values() ?? [])];
  }

  linkExists(from: TaskId, to: TaskId): boolean {
    this.#track();
    return this.#out.get(from)?.has(to) === true;
  }

  /** Whether a `from → to` link would create a cycle (edge not yet added). */
  wouldCreateCycle(from: TaskId, to: TaskId): boolean {
    this.#track();
    return from === to || this.#canReach(to, from);
  }

  /** Whether the current graph has a cycle (iterative Kahn, O(V + E), no recursion). */
  hasCycle(): boolean {
    this.#track();
    return this.#cyclic().size > 0;
  }

  // --- Internal ------------------------------------------------------------

  #reject(from: TaskId, to: TaskId): void {
    if (from === to) {
      throw new DependencyLinkError(`DependencyStore.link: cannot self-link task ${from}`);
    }
    if (this.#out.get(from)?.has(to)) {
      throw new DependencyLinkError(`DependencyStore.link: link ${from} → ${to} already exists`);
    }
  }

  /** Every dependency touching a task, each once (a stored self-loop would otherwise repeat). */
  #touching(taskId: TaskId): Set<Dependency> {
    return new Set([...(this.#out.get(taskId)?.values() ?? []), ...(this.#in.get(taskId)?.values() ?? [])]);
  }

  /** Insert or replace a dependency, keeping the pair indices and insertion order in step. */
  #put(dep: Dependency): void {
    const prev = this.#deps.get(dep.id);
    if (prev) {
      if (prev.from !== dep.from || prev.to !== dep.to) this.#unindex(prev);
    } else this.#seq.set(dep.id, this.#n++);
    this.#deps.set(dep.id, dep);
    this.#edge(this.#out, dep.from, dep.to, dep);
    this.#edge(this.#in, dep.to, dep.from, dep);
  }

  #drop(dep: Dependency): void {
    this.#deps.delete(dep.id);
    this.#seq.delete(dep.id);
    this.#unindex(dep);
  }

  #unindex(dep: Dependency): void {
    this.#edge(this.#out, dep.from, dep.to);
    this.#edge(this.#in, dep.to, dep.from);
  }

  /** Set (`dep` given) or delete one `a -> b` entry of an adjacency index. */
  #edge(m: Map<TaskId, Map<TaskId, Dependency>>, a: TaskId, b: TaskId, dep?: Dependency): void {
    const inner = m.get(a);
    if (!dep) {
      if (inner?.delete(b) && inner.size === 0) m.delete(a);
    } else if (inner) inner.set(b, dep);
    else m.set(a, new Map([[b, dep]]));
  }

  /** Kahn's algorithm: the nodes that never reach in-degree zero (on a cycle or downstream of one). */
  #cyclic(): Set<TaskId> {
    const degree = new Map<TaskId, number>();
    for (const [n, from] of this.#in) degree.set(n, from.size);
    const queue = [...this.#out.keys()].filter((n) => !degree.has(n));
    for (let i = 0; i < queue.length; i++) {
      for (const next of this.#out.get(queue[i]!)?.keys() ?? []) {
        const d = degree.get(next)! - 1;
        degree.set(next, d);
        if (d === 0) queue.push(next);
      }
    }
    const stuck = new Set<TaskId>();
    for (const [n, d] of degree) if (d > 0) stuck.add(n);
    return stuck;
  }

  /** Whether a path `start → ... → target` exists following from→to edges. */
  #canReach(start: TaskId, target: TaskId): boolean {
    const seen = new Set<TaskId>();
    const stack: TaskId[] = [start];
    for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
      if (node === target) return true;
      if (seen.has(node)) continue;
      seen.add(node);
      for (const next of this.#out.get(node)?.keys() ?? []) stack.push(next);
    }
    return false;
  }
}
