// Unit tests — SelectionStore (spec-selection.md §12.1). Headless: no DOM.
import { describe, it, expect } from 'vitest';
import { SelectionStore } from '../../src/store/selection-store.js';
import { effect } from '../../src/signals.js';
import { toTaskId } from '../../src/types.js';

const a = toTaskId('a');
const b = toTaskId('b');
const c = toTaskId('c');

describe('SelectionStore — replace/all', () => {
  it('replace([...]) then all() returns the same ids as a snapshot array', () => {
    const store = new SelectionStore();
    store.replace([a, b]);
    const snapshot = store.all();
    expect(snapshot).toEqual([a, b]);

    // Mutating the returned array does not affect internal state.
    snapshot.push(c);
    expect(store.all()).toEqual([a, b]);
  });

  it('replace() returns true when the set actually changes', () => {
    const store = new SelectionStore();
    expect(store.replace([a])).toBe(true);
  });

  it('replace() returns false for an order-different but content-identical set', () => {
    const store = new SelectionStore();
    store.replace([a, b]);
    expect(store.replace([b, a])).toBe(false);
    expect(store.all()).toEqual([a, b]); // unchanged internal order, not overwritten by the no-op
  });

  it('replace([]) on an already-empty store returns false', () => {
    const store = new SelectionStore();
    expect(store.replace([])).toBe(false);
  });

  it('replace([]) on a non-empty store returns true and empties all()', () => {
    const store = new SelectionStore();
    store.replace([a, b]);
    expect(store.replace([])).toBe(true);
    expect(store.all()).toEqual([]);
  });

  it('has(id)/size reflect the current set', () => {
    const store = new SelectionStore();
    expect(store.has(a)).toBe(false);
    expect(store.size).toBe(0);
    store.replace([a, b]);
    expect(store.has(a)).toBe(true);
    expect(store.has(c)).toBe(false);
    expect(store.size).toBe(2);
  });

  it('a duplicate id passed to replace() is deduplicated (backed by a Set)', () => {
    const store = new SelectionStore();
    store.replace([a, a, b]);
    expect(store.size).toBe(2);
    expect(new Set(store.all())).toEqual(new Set([a, b]));
  });
});

describe('SelectionStore — reactivity (revision)', () => {
  it('revision.value increments only when replace() returns true, driving an effect re-run', () => {
    const store = new SelectionStore();
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

    store.replace([b, a]); // order-different, content-identical -> no-op, no re-run
    expect(runs).toBe(3);

    store.replace([]); // changed -> re-run
    expect(runs).toBe(4);

    stop();
    store.replace([c]);
    expect(runs).toBe(4);
  });
});
