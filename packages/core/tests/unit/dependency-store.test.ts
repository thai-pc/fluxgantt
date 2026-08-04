import { describe, it, expect } from 'vitest';
import { DependencyStore, DependencyLinkError } from '../../src/store/dependency-store.js';
import { effect } from '../../src/signals.js';
import { toTaskId, type TaskId } from '../../src/types.js';

const id = (s: string): TaskId => toTaskId(s);
const A = id('task-a');
const B = id('task-b');
const C = id('task-c');

describe('DependencyStore — link', () => {
  it('creates a link with default FS lag 0', () => {
    const store = new DependencyStore();
    const dep = store.link(A, B);
    expect(dep.id).toMatch(/^dep-/);
    expect(dep).toMatchObject({ from: A, to: B, type: 'FS', lag: 0 });
    expect(store.size).toBe(1);
  });

  it('accepts a custom type and lag', () => {
    const store = new DependencyStore();
    const dep = store.link(A, B, 'SS', { lag: -4 });
    expect(dep.type).toBe('SS');
    expect(dep.lag).toBe(-4);
  });

  it('throws on a self-link', () => {
    const store = new DependencyStore();
    expect(() => store.link(A, A)).toThrow(/cannot self-link/);
  });

  it('throws on a duplicate from/to pair', () => {
    const store = new DependencyStore();
    store.link(A, B);
    expect(() => store.link(A, B)).toThrow(/already exists/);
  });

  // review A3: the three expected validation rejections are a DISTINCT error type, so callers
  // that tolerate a rejected link (drag-create-dependency's silent revert) can catch ONLY this
  // and let unrelated/programming errors propagate instead of being swallowed by a bare catch.
  it('raises validation rejections as DependencyLinkError (self / duplicate / cycle)', () => {
    const store = new DependencyStore();
    store.link(A, B);
    expect(() => store.link(A, A)).toThrow(DependencyLinkError); // self
    expect(() => store.link(A, B)).toThrow(DependencyLinkError); // duplicate
    expect(() => store.link(B, A)).toThrow(DependencyLinkError); // cycle
  });
});

describe('DependencyStore — cycle', () => {
  it('throws when a link creates a direct cycle (B→A after A→B)', () => {
    const store = new DependencyStore();
    store.link(A, B);
    expect(() => store.link(B, A)).toThrow(/cycle/);
  });

  it('throws when a link creates an indirect cycle (C→A after A→B→C)', () => {
    const store = new DependencyStore();
    store.link(A, B);
    store.link(B, C);
    expect(() => store.link(C, A)).toThrow(/cycle/);
  });

  it('wouldCreateCycle predicts correctly without adding an edge', () => {
    const store = new DependencyStore();
    store.link(A, B);
    store.link(B, C);
    expect(store.wouldCreateCycle(C, A)).toBe(true);
    expect(store.wouldCreateCycle(A, C)).toBe(false);
    expect(store.size).toBe(2);
  });

  it('allowCycle: true skips the check; hasCycle detects it', () => {
    const store = new DependencyStore();
    store.link(A, B);
    expect(store.hasCycle()).toBe(false);
    store.link(B, A, 'FS', { allowCycle: true });
    expect(store.hasCycle()).toBe(true);
  });
});

describe('DependencyStore — queries', () => {
  it('predecessors/successors/of', () => {
    const store = new DependencyStore();
    store.link(A, B);
    store.link(B, C);
    expect(store.predecessors(B).map((d) => d.from)).toEqual([A]);
    expect(store.successors(B).map((d) => d.to)).toEqual([C]);
    expect(store.of(B)).toHaveLength(2);
  });

  it('linkExists', () => {
    const store = new DependencyStore();
    store.link(A, B);
    expect(store.linkExists(A, B)).toBe(true);
    expect(store.linkExists(B, A)).toBe(false);
  });
});

describe('DependencyStore — remove', () => {
  it('unlink by pair', () => {
    const store = new DependencyStore();
    store.link(A, B);
    store.unlink(A, B);
    expect(store.linkExists(A, B)).toBe(false);
    expect(store.size).toBe(0);
  });

  it('remove theo id', () => {
    const store = new DependencyStore();
    const dep = store.link(A, B);
    store.remove(dep.id);
    expect(store.size).toBe(0);
  });

  it('removeForTask removes every link touching the task', () => {
    const store = new DependencyStore();
    store.link(A, B);
    store.link(B, C);
    store.removeForTask(B);
    expect(store.size).toBe(0);
  });
});

describe('DependencyStore — reactivity', () => {
  it('effect re-runs when the store changes', () => {
    const store = new DependencyStore();
    let runs = 0;
    const stop = effect(() => {
      const _ = store.size;
      runs++;
    });
    expect(runs).toBe(1);
    const dep = store.link(A, B);
    expect(runs).toBe(2);
    store.remove(dep.id);
    expect(runs).toBe(3);
    stop();
    store.link(A, B);
    expect(runs).toBe(3);
  });
});
