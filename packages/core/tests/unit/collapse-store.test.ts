// Unit tests — CollapseStore (spec-collapse-expand.md §9.1). Headless: no DOM.
import { describe, it, expect } from 'vitest';
import { CollapseStore } from '../../src/store/collapse-store.js';
import { effect } from '../../src/signals.js';
import { toTaskId } from '../../src/types.js';

const a = toTaskId('a');
const b = toTaskId('b');
const c = toTaskId('c');

describe('CollapseStore — replace/all', () => {
  it('replace([...]) then all() returns the same ids as a snapshot array', () => {
    const store = new CollapseStore();
    store.replace([a, b]);
    const snapshot = store.all();
    expect(snapshot).toEqual([a, b]);

    // Mutating a copy of the returned array does not affect internal state.
    const mutableCopy = [...snapshot, c];
    expect(mutableCopy).toEqual([a, b, c]);
    expect(store.all()).toEqual([a, b]);
  });

  it('replace() returns true when the set actually changes', () => {
    const store = new CollapseStore();
    expect(store.replace([a])).toBe(true);
  });

  it('replace() returns false (no-op) for an order-different but content-identical set', () => {
    const store = new CollapseStore();
    store.replace([a, b]);
    expect(store.replace([b, a])).toBe(false);
    expect(store.all()).toEqual([a, b]); // unchanged internal order, not overwritten by the no-op
  });

  it('replace([]) on an already-empty store returns false', () => {
    const store = new CollapseStore();
    expect(store.replace([])).toBe(false);
  });

  it('replace([]) on a non-empty store returns true and empties all()', () => {
    const store = new CollapseStore();
    store.replace([a, b]);
    expect(store.replace([])).toBe(true);
    expect(store.all()).toEqual([]);
  });

  it('has(id)/size reflect the current set', () => {
    const store = new CollapseStore();
    expect(store.has(a)).toBe(false);
    expect(store.size).toBe(0);
    store.replace([a, b]);
    expect(store.has(a)).toBe(true);
    expect(store.has(c)).toBe(false);
    expect(store.size).toBe(2);
  });

  it('a duplicate id passed to replace() is deduplicated (backed by a Set)', () => {
    const store = new CollapseStore();
    store.replace([a, a, b]);
    expect(store.size).toBe(2);
    expect(new Set(store.all())).toEqual(new Set([a, b]));
  });
});

describe('CollapseStore — delete()', () => {
  it('delete() on a not-present id returns false, no revision bump', () => {
    const store = new CollapseStore();
    store.replace([a]);
    let runs = 0;
    const stop = effect(() => {
      void store.revision.value;
      runs++;
    });
    expect(runs).toBe(1);

    expect(store.delete(b)).toBe(false);
    expect(runs).toBe(1); // no re-run: nothing actually changed
    expect(store.all()).toEqual([a]);
    stop();
  });

  it('delete() on a present id returns true, bumps revision, removes exactly that id', () => {
    const store = new CollapseStore();
    store.replace([a, b]);
    let runs = 0;
    const stop = effect(() => {
      void store.revision.value;
      runs++;
    });
    expect(runs).toBe(1);

    expect(store.delete(a)).toBe(true);
    expect(runs).toBe(2);
    expect(store.all()).toEqual([b]);
    stop();
  });
});

describe('CollapseStore — reactivity (revision)', () => {
  it('revision.value increments exactly once per actual change (replace or delete), never on a no-op', () => {
    const store = new CollapseStore();
    let runs = 0;
    const stop = effect(() => {
      void store.revision.value;
      runs++;
    });
    expect(runs).toBe(1);

    store.replace([a]); // changed -> re-run
    expect(runs).toBe(2);

    store.replace([a]); // no-op -> no re-run
    expect(runs).toBe(2);

    store.replace([a, b]); // changed -> re-run
    expect(runs).toBe(3);

    store.delete(c); // not present -> no-op, no re-run
    expect(runs).toBe(3);

    store.delete(a); // present -> re-run
    expect(runs).toBe(4);

    stop();
  });

  it('has()/size/all() are tracked reads — an effect reading only has() re-runs on a change', () => {
    const store = new CollapseStore();
    let runs = 0;
    let lastHasA = false;
    const stop = effect(() => {
      lastHasA = store.has(a);
      runs++;
    });
    expect(runs).toBe(1);
    expect(lastHasA).toBe(false);

    store.replace([a]);
    expect(runs).toBe(2);
    expect(lastHasA).toBe(true);

    stop();
  });
});
