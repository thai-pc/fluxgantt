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
  // Coarse-grained revision for Wave 1. Fine-grained per-task deltas (spec principle 2)
  // will come later via the event layer.
  readonly #rev = signal(0);

  constructor(initial?: readonly Task[]) {
    if (initial) {
      for (const t of initial) this.#tasks.set(t.id, { ...t });
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
    this.#tasks.set(id, task);
    this.#bump();
    return task;
  }

  update(id: TaskId, patch: TaskPatch): Task {
    const current = this.#tasks.get(id);
    if (!current) throw new Error(`TaskStore.update: task ${id} not found`);
    const next: Task = { ...current, ...patch, id, updatedAt: new Date() };
    this.#tasks.set(id, next);
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
    this.#tasks.set(task.id, task);
    this.#bump();
    return task;
  }

  /** Remove a task; cascade-removes all descendants in the hierarchy. */
  remove(id: TaskId): void {
    if (!this.#tasks.has(id)) return;
    for (const child of this.#childrenOf(id)) this.remove(child.id);
    this.#tasks.delete(id);
    this.#bump();
  }

  clear(): void {
    if (this.#tasks.size === 0) return;
    this.#tasks.clear();
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

  #childrenOf(id: TaskId): Task[] {
    return [...this.#tasks.values()].filter((t) => t.parent === id);
  }
}
