// Reactive primitive tự viết — semantics theo Preact Signals, ZERO dependency với
// React/Vue (spec §4.1, §5.2). Headless: không đụng DOM/framework.
//
// API: signal() / computed() / effect() / batch() / untracked().
// Mô hình push-based đơn giản: signal là source, effect/computed là subscriber.
// Đây là skeleton Wave 1 — đủ đúng cho dependency tracking + batching; tối ưu
// glitch-free/diamond để sau (xem note cuối file).

export interface ReadonlySignal<T> {
  readonly value: T;
  /** Đọc giá trị KHÔNG đăng ký dependency. */
  peek(): T;
}

type DepSet = Set<ReactiveNode>;

/** Node phản ứng (effect hoặc computed) — thứ có thể "subscribe" vào signal. */
abstract class ReactiveNode {
  /** Các tập subscriber mà node này đang nằm trong (để cleanup trước khi chạy lại). */
  readonly deps: Set<DepSet> = new Set();

  abstract _notify(): void;

  protected _cleanup(): void {
    for (const dep of this.deps) dep.delete(this);
    this.deps.clear();
  }
}

let activeSub: ReactiveNode | null = null;
let batchDepth = 0;
const pending = new Set<EffectImpl>();

function link(subscribers: DepSet): void {
  if (activeSub) {
    subscribers.add(activeSub);
    activeSub.deps.add(subscribers);
  }
}

export class Signal<T> implements ReadonlySignal<T> {
  readonly #subs: DepSet = new Set();
  #value: T;

  constructor(value: T) {
    this.#value = value;
  }

  get value(): T {
    link(this.#subs);
    return this.#value;
  }

  set value(next: T) {
    if (Object.is(next, this.#value)) return;
    this.#value = next;
    for (const sub of [...this.#subs]) sub._notify();
  }

  peek(): T {
    return this.#value;
  }
}

class ComputedImpl<T> extends ReactiveNode implements ReadonlySignal<T> {
  readonly #subs: DepSet = new Set();
  readonly #fn: () => T;
  #value: T | undefined;
  #dirty = true;

  constructor(fn: () => T) {
    super();
    this.#fn = fn;
  }

  _notify(): void {
    if (this.#dirty) return;
    this.#dirty = true;
    for (const sub of [...this.#subs]) sub._notify();
  }

  get value(): T {
    link(this.#subs);
    if (this.#dirty) {
      this._cleanup();
      const prev = activeSub;
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- reactive graph: computed tự đăng ký làm subscriber khi tính
      activeSub = this;
      try {
        this.#value = this.#fn();
      } finally {
        activeSub = prev;
      }
      this.#dirty = false;
    }
    return this.#value as T;
  }

  peek(): T {
    if (this.#dirty) {
      const prev = activeSub;
      activeSub = null;
      try {
        this.#value = this.#fn();
      } finally {
        activeSub = prev;
      }
      this.#dirty = false;
    }
    return this.#value as T;
  }
}

class EffectImpl extends ReactiveNode {
  readonly #fn: () => void;
  #active = true;

  constructor(fn: () => void) {
    super();
    this.#fn = fn;
    this._run();
  }

  _notify(): void {
    if (!this.#active) return;
    if (batchDepth > 0) pending.add(this);
    else this._run();
  }

  _run(): void {
    if (!this.#active) return;
    this._cleanup();
    const prev = activeSub;
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- reactive graph: effect tự đăng ký làm subscriber khi chạy
    activeSub = this;
    try {
      this.#fn();
    } finally {
      activeSub = prev;
    }
  }

  dispose(): void {
    this.#active = false;
    this._cleanup();
    pending.delete(this);
  }
}

function flush(): void {
  // Lặp tới khi ổn định (effect có thể kéo theo effect khác).
  let guard = 0;
  while (pending.size > 0) {
    if (++guard > 10_000) throw new Error('signals: flush loop không hội tụ (cycle?)');
    const batchList = [...pending];
    pending.clear();
    for (const e of batchList) e._run();
  }
}

/** Tạo một reactive signal có thể đọc/ghi qua `.value`. */
export function signal<T>(value: T): Signal<T> {
  return new Signal(value);
}

/** Giá trị dẫn xuất, memoized, tự cập nhật khi dependency đổi. */
export function computed<T>(fn: () => T): ReadonlySignal<T> {
  return new ComputedImpl(fn);
}

/** Chạy `fn` ngay và chạy lại mỗi khi dependency đổi. Trả về hàm dispose. */
export function effect(fn: () => void): () => void {
  const e = new EffectImpl(fn);
  return () => e.dispose();
}

/** Gộp nhiều write thành một lần flush effect. */
export function batch<T>(fn: () => T): T {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) flush();
  }
}

/** Chạy `fn` mà KHÔNG đăng ký dependency cho subscriber hiện tại. */
export function untracked<T>(fn: () => T): T {
  const prev = activeSub;
  activeSub = null;
  try {
    return fn();
  } finally {
    activeSub = prev;
  }
}

// NOTE (Wave 1 skeleton): push-based naive có thể chạy effect dư trong đồ thị
// diamond (A→B, A→C, B&C→D ⇒ D có thể chạy 2 lần). Đúng kết quả, chưa tối ưu.
// Sẽ thay bằng version-based / lazy pull glitch-free khi tối ưu performance.
