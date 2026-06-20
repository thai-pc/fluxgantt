// TaskStore — reactive task collection (spec §5.1 State Layer, §7.2 Task Operations).
// Headless: chỉ state + logic, không render. Reactivity qua signal.
import { signal, type ReadonlySignal } from '../signals.js';
import { toTaskId, type Task, type TaskId } from '../types.js';

/** Input để tạo task: bỏ field do store tự sinh; `id` tuỳ chọn (auto nếu thiếu). */
export type TaskInput = Omit<Task, 'id' | 'createdAt' | 'updatedAt'> & { id?: TaskId };

/** Patch update: không cho đổi `id`/`createdAt`. */
export type TaskPatch = Partial<Omit<Task, 'id' | 'createdAt' | 'updatedAt'>>;

const newTaskId = (): TaskId => toTaskId(`task-${globalThis.crypto.randomUUID()}`);

export class TaskStore {
  readonly #tasks = new Map<TaskId, Task>();
  // Revision coarse-grained cho Wave 1. Fine-grained per-task delta (spec principle 2)
  // sẽ thêm sau qua event layer.
  readonly #rev = signal(0);

  constructor(initial?: readonly Task[]) {
    if (initial) {
      for (const t of initial) this.#tasks.set(t.id, { ...t });
    }
  }

  /** Signal revision — đọc `.value` trong effect/computed để theo dõi mọi thay đổi store. */
  get revision(): ReadonlySignal<number> {
    return this.#rev;
  }

  #bump(): void {
    this.#rev.value++;
  }

  /** Đăng ký dependency reactive cho các hàm đọc. */
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
    if (!current) throw new Error(`TaskStore.update: không tìm thấy task ${id}`);
    const next: Task = { ...current, ...patch, id, updatedAt: new Date() };
    this.#tasks.set(id, next);
    this.#bump();
    return next;
  }

  /** Xoá task; cascade xoá toàn bộ con cháu trong hierarchy. */
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
