// TaskStore — reactive task collection (spec §5.1 State Layer, §7.2 Task Operations).
// Headless: state + logic only, no rendering. Reactivity via signals.
import { signal, type ReadonlySignal } from '../signals.js';
import { toTaskId, type Task, type TaskId } from '../types.js';

/** Input to create a task: omits store-generated fields; `id` is optional (auto when absent). */
export type TaskInput = Omit<Task, 'id' | 'createdAt' | 'updatedAt'> & { id?: TaskId };

/** Patch update: cannot change `id`/`createdAt`. */
export type TaskPatch = Partial<Omit<Task, 'id' | 'createdAt' | 'updatedAt'>>;

const newTaskId = (): TaskId => toTaskId(`task-${globalThis.crypto.randomUUID()}`);

export class TaskStore {
  readonly #tasks = new Map<TaskId, Task>();
  // parent -> direct children (unordered); `#pos` restores global insertion order in children().
  readonly #kids = new Map<TaskId, Set<TaskId>>();
  readonly #pos = new Map<TaskId, number>();
  #seq = 0;
  // Coarse-grained revision for Wave 1. Fine-grained per-task deltas (spec principle 2)
  // will come later via the event layer.
  readonly #rev = signal(0);

  constructor(initial?: readonly Task[]) {
    if (initial) {
      for (const t of initial) this.#put({ ...t });
    }
  }

  /** Revision signal — read `.value` inside an effect/computed to track every store change. */
  get revision(): ReadonlySignal<number> {
    return this.#rev;
  }

  #bump(): void {
    this.#rev.value++;
  }

  /** Register a reactive dependency for read methods. */
  #track(): void {
    void this.#rev.value;
  }

  // --- Mutations -----------------------------------------------------------

  add(input: TaskInput): Task {
    const now = new Date();
    const id = input.id ?? newTaskId();
    const task: Task = { ...input, id, createdAt: now, updatedAt: now };
    this.#put(task);
    this.#bump();
    return task;
  }

  update(id: TaskId, patch: TaskPatch): Task {
    const current = this.#tasks.get(id);
    if (!current) throw new Error(`TaskStore.update: task ${id} not found`);
    const next: Task = { ...current, ...patch, id, updatedAt: new Date() };
    this.#put(next);
    this.#bump();
    return next;
  }

  /**
   * History-replay support (undo/redo, gantt.ts). Inserts the EXACT `Task` object verbatim: no
   * id generation, no `createdAt`/`updatedAt` re-stamping, no validation. Distinct from `add()`
   * (which always mints a fresh `id` when absent and ALWAYS re-stamps `createdAt`/`updatedAt`
   * to `new Date()`) and `update()` (partial patch + fresh `updatedAt`) — neither can reproduce
   * a bit-for-bit-identical prior `Task`, which undo/redo needs so that "undo, then redo" lands
   * on an object equal (by value, all fields) to the one that existed before the undo, not a
   * near-identical one with drifted timestamps. Bumps `revision` like every other mutation.
   */
  restore(task: Task): Task {
    this.#put(task);
    this.#bump();
    return task;
  }

  /** Remove a task; cascade-removes all descendants in the hierarchy. */
  remove(id: TaskId): void {
    const root = this.#tasks.get(id);
    if (!root) return;
    const doomed = this.subtree(id);
    if (root.parent !== undefined) this.#kids.get(root.parent)?.delete(id);
    for (const d of doomed) {
      this.#tasks.delete(d);
      this.#pos.delete(d);
      this.#kids.delete(d);
    }
    this.#bump();
  }

  /**
   * `id` and all its descendants, deepest first, siblings in global insertion order (the order
   * `task:removed` is emitted in). Iterative, so a deep parent chain cannot overflow the stack;
   * the visited check also stops a host-made parent cycle from looping forever.
   *
   * @internal Shared by `remove()` and `Gantt.removeTask`; not part of the stable API.
   */
  subtree(id: TaskId): TaskId[] {
    const out = new Set<TaskId>();
    const stack = [id];
    for (let n = stack.pop(); n !== undefined; n = stack.pop()) {
      if (out.has(n)) continue;
      out.add(n);
      for (const child of this.#childrenOf(n)) stack.push(child.id);
    }
    return [...out].reverse(); // node then children right-to-left, reversed = post-order
  }

  clear(): void {
    this.#kids.clear(); // also drops empty sets left by dangling parent ids
    if (this.#tasks.size === 0) return;
    this.#tasks.clear();
    this.#pos.clear();
    this.#bump();
  }

  // --- Reads (reactive) ----------------------------------------------------

  get(id: TaskId): Task | undefined {
    this.#track();
    return this.#tasks.get(id);
  }

  has(id: TaskId): boolean {
    this.#track();
    return this.#tasks.has(id);
  }

  get size(): number {
    this.#track();
    return this.#tasks.size;
  }

  all(): Task[] {
    this.#track();
    return [...this.#tasks.values()];
  }

  find(predicate: (task: Task) => boolean): Task[] {
    return this.all().filter(predicate);
  }

  children(id: TaskId): Task[] {
    this.#track();
    return this.#childrenOf(id);
  }

  roots(): Task[] {
    this.#track();
    return [...this.#tasks.values()].filter((t) => t.parent === undefined);
  }

  // --- Internal ------------------------------------------------------------

  /** Insert or replace a task, keeping the parent index and insertion position in step. */
  #put(task: Task): void {
    const prev = this.#tasks.get(task.id);
    if (!prev) this.#pos.set(task.id, this.#seq++);
    if (prev?.parent !== task.parent) {
      if (prev?.parent !== undefined) this.#kids.get(prev.parent)?.delete(task.id);
      if (task.parent !== undefined) {
        const set = this.#kids.get(task.parent);
        if (set) set.add(task.id);
        else this.#kids.set(task.parent, new Set([task.id]));
      }
    }
    this.#tasks.set(task.id, task);
  }

  /** Direct children in global insertion order (what a filter over `#tasks` would give). */
  #childrenOf(id: TaskId): Task[] {
    const kids = this.#kids.get(id);
    if (!kids) return [];
    return [...kids].sort((a, b) => this.#pos.get(a)! - this.#pos.get(b)!).map((k) => this.#tasks.get(k)!);
  }
}
