import { describe, it, expect } from 'vitest';
import { DependencyStore } from '../../src/store/dependency-store.js';
import { effect } from '../../src/signals.js';
import { toTaskId, type TaskId } from '../../src/types.js';

const id = (s: string): TaskId => toTaskId(s);
const A = id('task-a');
const B = id('task-b');
const C = id('task-c');

describe('DependencyStore — link', () => {
  it('tạo liên kết với default FS lag 0', () => {
    const store = new DependencyStore();
    const dep = store.link(A, B);
    expect(dep.id).toMatch(/^dep-/);
    expect(dep).toMatchObject({ from: A, to: B, type: 'FS', lag: 0 });
    expect(store.size).toBe(1);
  });

  it('nhận type và lag tuỳ chỉnh', () => {
    const store = new DependencyStore();
    const dep = store.link(A, B, 'SS', { lag: -4 });
    expect(dep.type).toBe('SS');
    expect(dep.lag).toBe(-4);
  });

  it('throw khi self-link', () => {
    const store = new DependencyStore();
    expect(() => store.link(A, A)).toThrow(/tự liên kết/);
  });

  it('throw khi trùng cặp from/to', () => {
    const store = new DependencyStore();
    store.link(A, B);
    expect(() => store.link(A, B)).toThrow(/đã tồn tại/);
  });
});

describe('DependencyStore — cycle', () => {
  it('throw khi liên kết tạo cycle trực tiếp (B→A sau A→B)', () => {
    const store = new DependencyStore();
    store.link(A, B);
    expect(() => store.link(B, A)).toThrow(/cycle/);
  });

  it('throw khi liên kết tạo cycle gián tiếp (C→A sau A→B→C)', () => {
    const store = new DependencyStore();
    store.link(A, B);
    store.link(B, C);
    expect(() => store.link(C, A)).toThrow(/cycle/);
  });

  it('wouldCreateCycle dự đoán đúng mà không thêm edge', () => {
    const store = new DependencyStore();
    store.link(A, B);
    store.link(B, C);
    expect(store.wouldCreateCycle(C, A)).toBe(true);
    expect(store.wouldCreateCycle(A, C)).toBe(false);
    expect(store.size).toBe(2);
  });

  it('allowCycle: true bỏ qua kiểm tra; hasCycle phát hiện', () => {
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
  it('unlink theo cặp', () => {
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

  it('removeForTask gỡ mọi liên kết chạm task', () => {
    const store = new DependencyStore();
    store.link(A, B);
    store.link(B, C);
    store.removeForTask(B);
    expect(store.size).toBe(0);
  });
});

describe('DependencyStore — reactivity', () => {
  it('effect chạy lại khi store đổi', () => {
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
