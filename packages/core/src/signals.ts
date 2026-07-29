// Hand-rolled reactive primitive — Preact-Signals-like semantics, ZERO dependency on
// React/Vue (spec §4.1, §5.2). Headless: never touches the DOM or any framework.
//
// API: signal() / computed() / effect() / batch() / untracked().
// Simple push-based model: a signal is a source, an effect/computed is a subscriber.
// This is the Wave 1 skeleton — correct enough for dependency tracking + batching;
// glitch-free/diamond optimization is deferred (see note at the end of the file).

export interface ReadonlySignal<T> {
  readonly value: T;
  /** Read the value WITHOUT registering a dependency. */
  peek(): T;
}

type DepSet = Set<ReactiveNode>;

/** A reactive node (effect or computed) — something that can subscribe to a signal. */
abstract class ReactiveNode {
  /** Subscriber sets this node currently belongs to (used to clean up before re-running). */
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
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- reactive graph: the computed registers itself as the active subscriber while evaluating
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
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- reactive graph: the effect registers itself as the active subscriber while running
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
  // Loop until stable (an effect may trigger further effects).
  let guard = 0;
  while (pending.size > 0) {
    if (++guard > 10_000) throw new Error('signals: flush loop did not converge (cycle?)');
    const batchList = [...pending];
    pending.clear();
    for (const e of batchList) e._run();
  }
}

/** Create a reactive signal that can be read/written through `.value`. */
export function signal<T>(value: T): Signal<T> {
  return new Signal(value);
}

/** A derived, memoized value that updates automatically when its dependencies change. */
export function computed<T>(fn: () => T): ReadonlySignal<T> {
  return new ComputedImpl(fn);
}

/** Run `fn` immediately and re-run it whenever its dependencies change. Returns a dispose fn. */
export function effect(fn: () => void): () => void {
  const e = new EffectImpl(fn);
  return () => e.dispose();
}

/** Batch multiple writes into a single effect flush. */
export function batch<T>(fn: () => T): T {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) flush();
  }
}

/** Run `fn` WITHOUT registering dependencies for the current subscriber. */
export function untracked<T>(fn: () => T): T {
  const prev = activeSub;
  activeSub = null;
  try {
    return fn();
  } finally {
    activeSub = prev;
  }
}

// NOTE (Wave 1 skeleton): the naive push-based model may run an effect redundantly in a
// diamond graph (A→B, A→C, B&C→D ⇒ D may run twice). The result is correct, just not
// optimal. To be replaced with a version-based / lazy-pull glitch-free model when we
// optimize performance.
