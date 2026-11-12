// Operation counter for the load-cost harness (spec-mutation-batching.md §8 item 3, PR 0).
// Counts container work instead of wall-clock so the numbers are deterministic on any machine:
//   - every Map/Set get/set/has/delete/add call,
//   - every element a Map/Set iterator yields (a `for..of` / spread over a store Map is O(size)
//     but is ONE call, so counting calls alone would hide exactly the scans we care about),
//   - every element visited by Array filter/map/forEach/find/some/every/indexOf/includes/
//     findIndex/reduce (counted as `length` per call, an upper bound for the early-exit ones).
// Prototypes are patched only for the duration of `countOps` and always restored.
export interface OpCount {
  /** Total container operations. */
  readonly ops: number;
}

type AnyFn = (this: unknown, ...a: unknown[]) => unknown;

export function countOps<T>(fn: () => T): { result: T; ops: number } {
  let ops = 0;
  const restore: Array<() => void> = [];
  const patch = (proto: object, key: string | symbol, wrap: (orig: AnyFn) => AnyFn): void => {
    const rec = proto as Record<string | symbol, AnyFn>;
    const orig = rec[key]!;
    rec[key] = wrap(orig);
    restore.push(() => {
      rec[key] = orig;
    });
  };
  const call = (orig: AnyFn): AnyFn =>
    function (this: unknown, ...a) {
      ops++;
      return orig.apply(this, a);
    };
  const iter = (orig: AnyFn): AnyFn =>
    function (this: unknown, ...a) {
      const it = orig.apply(this, a) as Iterator<unknown>;
      const wrapped = {
        next(): IteratorResult<unknown> {
          const r = it.next();
          if (!r.done) ops++;
          return r;
        },
        [Symbol.iterator]() {
          return wrapped;
        },
      };
      return wrapped;
    };
  const scan = (orig: AnyFn): AnyFn =>
    function (this: unknown, ...a) {
      ops += (this as unknown[]).length;
      return orig.apply(this, a);
    };

  for (const key of ['get', 'set', 'has', 'delete']) patch(Map.prototype, key, call);
  for (const key of ['add', 'has', 'delete']) patch(Set.prototype, key, call);
  for (const key of ['entries', 'keys', 'values', Symbol.iterator]) {
    patch(Map.prototype, key, iter);
    patch(Set.prototype, key, iter);
  }
  for (const key of ['filter', 'map', 'forEach', 'find', 'some', 'every', 'indexOf', 'includes', 'findIndex', 'reduce']) {
    patch(Array.prototype, key, scan);
  }
  try {
    const result = fn();
    return { result, ops };
  } finally {
    for (const undo of restore.reverse()) undo();
  }
}
