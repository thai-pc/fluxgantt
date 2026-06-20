import { describe, it, expect } from 'vitest';
import { signal, computed, effect, batch, untracked } from '../../src/signals.js';

describe('signal', () => {
  it('đọc/ghi giá trị qua .value', () => {
    const s = signal(1);
    expect(s.value).toBe(1);
    s.value = 2;
    expect(s.value).toBe(2);
  });

  it('peek() không đăng ký dependency', () => {
    const s = signal(1);
    let runs = 0;
    effect(() => {
      s.peek();
      runs++;
    });
    expect(runs).toBe(1);
    s.value = 5;
    expect(runs).toBe(1);
  });

  it('không notify khi giá trị không đổi (Object.is)', () => {
    const s = signal(1);
    let runs = 0;
    effect(() => {
      const _ = s.value;
      runs++;
    });
    s.value = 1;
    expect(runs).toBe(1);
  });
});

describe('computed', () => {
  it('dẫn xuất và cập nhật khi dependency đổi', () => {
    const a = signal(2);
    const b = signal(3);
    const sum = computed(() => a.value + b.value);
    expect(sum.value).toBe(5);
    a.value = 10;
    expect(sum.value).toBe(13);
  });

  it('memoized — chỉ tính lại khi dirty', () => {
    const a = signal(1);
    let calls = 0;
    const c = computed(() => {
      calls++;
      return a.value * 2;
    });
    expect(c.value).toBe(2);
    expect(c.value).toBe(2); // đọc lại không tính lại
    expect(calls).toBe(1);
    a.value = 5;
    expect(c.value).toBe(10);
    expect(calls).toBe(2);
  });
});

describe('effect', () => {
  it('chạy ngay và chạy lại khi dependency đổi; dispose dừng', () => {
    const s = signal(1);
    let runs = 0;
    const stop = effect(() => {
      const _ = s.value;
      runs++;
    });
    expect(runs).toBe(1);
    s.value = 2;
    expect(runs).toBe(2);
    stop();
    s.value = 3;
    expect(runs).toBe(2);
  });

  it('chạy lại khi computed phụ thuộc đổi', () => {
    const n = signal(1);
    const dbl = computed(() => n.value * 2);
    let seen = -1;
    effect(() => {
      seen = dbl.value;
    });
    expect(seen).toBe(2);
    n.value = 5;
    expect(seen).toBe(10);
  });
});

describe('batch', () => {
  it('gộp nhiều write thành một lần chạy effect', () => {
    const a = signal(1);
    let runs = 0;
    effect(() => {
      const _ = a.value;
      runs++;
    });
    expect(runs).toBe(1);
    batch(() => {
      a.value = 2;
      a.value = 3;
      a.value = 4;
    });
    expect(runs).toBe(2);
    expect(a.value).toBe(4);
  });
});

describe('untracked', () => {
  it('đọc bên trong không đăng ký dependency', () => {
    const a = signal(1);
    let runs = 0;
    effect(() => {
      runs++;
      untracked(() => a.value);
    });
    expect(runs).toBe(1);
    a.value = 2;
    expect(runs).toBe(1);
  });
});
