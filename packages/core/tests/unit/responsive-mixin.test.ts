// @vitest-environment jsdom
//
// `withResponsive()` tests (spec-responsive-mobile.md). Runs under jsdom (per-file override,
// matching theme-mixin.test.ts) because the whole capability is "observe the environment and write
// to a real mount container" — there is nothing to assert without a DOM.
//
// jsdom ships NEITHER `matchMedia` NOR `ResizeObserver`, and both absences are themselves cases
// under test (the mixin must degrade quietly, never throw). Every other test installs explicit
// stubs, so the pointer type and the container width are driven deterministically rather than
// inherited from the machine running CI.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGantt as createGanttBase } from '../../src/gantt.js';
import { withRender } from '../../src/render/mixin.js';
import { withResponsive } from '../../src/responsive/mixin.js';
import type { ResponsiveOptions } from '../../src/responsive/mixin.js';
import { ROW_HEIGHT } from '../../src/render/renderer-base.js';
import type { Density } from '../../src/types.js';
import { toTaskId } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';

const TASKS: readonly TaskInput[] = [
  {
    id: toTaskId('t1'),
    name: 'Task 1',
    start: '2026-01-05',
    end: '2026-01-09',
    progress: 0,
    type: 'task',
  },
];

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
  vi.unstubAllGlobals();
});

/** Minimal `MediaQueryList` stub with a working listener set, so a pointer-type FLIP can be
 *  simulated the way a real device change fires it (tablet docked to a mouse). Mirrors
 *  theme-mixin.test.ts's stub. */
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  const mql = {
    matches,
    media: '(pointer: coarse)',
    addEventListener: vi.fn((_: string, fn: () => void) => listeners.add(fn)),
    removeEventListener: vi.fn((_: string, fn: () => void) => listeners.delete(fn)),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => mql),
  );
  return {
    mql,
    flip(next: boolean): void {
      mql.matches = next;
      for (const fn of listeners) fn();
    },
    get listenerCount(): number {
      return listeners.size;
    },
  };
}

/** `ResizeObserver` stub that records observed elements and exposes a manual `fire()` — jsdom has
 *  no layout engine, so a real observer would never fire anyway. */
function stubResizeObserver() {
  const instances: { el: Element | undefined; disconnected: boolean; cb: () => void }[] = [];
  class RO {
    private readonly rec: (typeof instances)[number];
    constructor(cb: () => void) {
      this.rec = { el: undefined, disconnected: false, cb };
      instances.push(this.rec);
    }
    observe(el: Element): void {
      this.rec.el = el;
    }
    disconnect(): void {
      this.rec.disconnected = true;
    }
    unobserve(): void {}
  }
  vi.stubGlobal('ResizeObserver', RO);
  return {
    instances,
    /** Re-runs every live observer's callback, as a rotation/split-screen resize would. */
    fire(): void {
      for (const i of instances) if (!i.disconnected) i.cb();
    },
  };
}

/** Stubs `clientWidth` (jsdom reports 0 for everything) so the label-column clamp has a real
 *  viewport to measure against. */
function setClientWidth(el: HTMLElement, width: number): void {
  Object.defineProperty(el, 'clientWidth', { value: width, configurable: true });
}

function responsive(options?: ResponsiveOptions) {
  return withResponsive(withRender(createGanttBase({ tasks: TASKS })), options);
}

/** The painted row height, read back out of the DOM rather than off the option we passed in —
 *  the point of the feature is that rows actually get taller. A row `<g>` carries no `height` of
 *  its own (it is a transform-free ARIA grouping), so this derives it from the `<svg>`'s total
 *  height, which is `HEADER_HEIGHT (32) + rows * rowHeight` for the single-task fixture. */
function paintedRowHeight(el: HTMLElement): number {
  const svg = el.querySelector('svg')!;
  return Number(svg.getAttribute('height')) - 32;
}

function expectDensity(el: HTMLElement, density: Density): void {
  expect(paintedRowHeight(el)).toBe(ROW_HEIGHT[density]);
}

/** The `<style>` this mixin owns, identified by its own marker attribute. */
function styleEl(el: HTMLElement): HTMLStyleElement | null {
  return el.querySelector<HTMLStyleElement>('style[data-fg-responsive]');
}

describe('withResponsive — coarse-pointer adaptation', () => {
  it('under a coarse pointer: switches to touch density, injects its stylesheet, and sets touch-action on the pointer target', () => {
    stubMatchMedia(true);
    stubResizeObserver();
    const gantt = responsive();
    gantt.mount(container);

    expect(gantt.isCoarsePointer()).toBe(true);
    expectDensity(container, 'touch');
    expect(styleEl(container)).not.toBeNull();
    expect(styleEl(container)!.textContent).toContain('--fg-link-handle-radius');
    // `touch-action` is declared in that stylesheet, media-gated, NOT inline on the root — see
    // COARSE_STYLE_TEXT's comment for why. Asserted as text because jsdom has no CSSOM support
    // for the property at all (it drops an inline `touch-action` silently), so a computed-style
    // assertion here would be vacuous rather than strict.
    expect(styleEl(container)!.textContent).toContain('touch-action: none');
    expect(styleEl(container)!.textContent).toContain('(pointer: coarse)');
  });

  it('under a fine pointer: none of it — no stylesheet, no touch-action, default density', () => {
    stubMatchMedia(false);
    stubResizeObserver();
    const gantt = responsive();
    gantt.mount(container);

    expect(gantt.isCoarsePointer()).toBe(false);
    expectDensity(container, 'default');
    expect(styleEl(container)).toBeNull();
  });

  it('a pointer-type flip re-applies in BOTH directions (a tablet docked to a mouse goes back to desktop sizing)', () => {
    const media = stubMatchMedia(false);
    stubResizeObserver();
    const gantt = responsive();
    gantt.mount(container);
    expect(styleEl(container)).toBeNull();

    media.flip(true);
    expect(styleEl(container)).not.toBeNull();
    expectDensity(container, 'touch');

    media.flip(false);
    expect(styleEl(container)).toBeNull();
    // Restored to the CONFIGURED density, not left on touch sizing.
    expectDensity(container, 'default');
  });

  it('honours an explicit touchDensity — the touch arbitration without the 48px rows', () => {
    stubMatchMedia(true);
    stubResizeObserver();
    const gantt = responsive({ touchDensity: 'comfortable' });
    gantt.mount(container);

    expectDensity(container, 'comfortable');
    // Still fully armed — density is orthogonal to arbitration.
    expect(styleEl(container)).not.toBeNull();
  });
});

describe('withResponsive — label-column clamp', () => {
  it.each([
    // width, expected: ratio 0.4 clamped into [96, 160]
    [393, 157.2], // Pixel 5 portrait — 0.4 * 393, inside the band
    [200, 96], // very narrow — floored, a narrower column is unreadable
    [1440, 160], // desktop — ceilinged at the default; never WIDER than before
  ])('a %ipx container yields a %fpx label column', (width, expected) => {
    stubMatchMedia(true);
    stubResizeObserver();
    setClientWidth(container, width);
    const gantt = responsive();
    gantt.mount(container);

    expect(gantt.getLabelColumnWidth()).toBeCloseTo(expected, 5);
    // And it reached the renderer, not just the mixin's own bookkeeping.
    expect(container.querySelector('svg')!.getAttribute('width')).not.toBeNull();
  });

  it('a resize recomputes and repaints; a resize that changes nothing does not', () => {
    stubMatchMedia(true);
    const ro = stubResizeObserver();
    setClientWidth(container, 393);
    const gantt = responsive();
    gantt.mount(container);
    expect(ro.instances[0]!.el).toBe(container);

    const widthAt393 = gantt.getLabelColumnWidth();
    setClientWidth(container, 1440); // rotation / split-screen exit
    ro.fire();
    expect(gantt.getLabelColumnWidth()).toBe(160);
    expect(gantt.getLabelColumnWidth()).not.toBe(widthAt393);

    // Idempotent: firing again at the same width is a no-op, so a scroll-triggered observer
    // callback storm cannot cause a repaint storm.
    const svgBefore = container.querySelector('svg');
    ro.fire();
    expect(container.querySelector('svg')).toBe(svgBefore);
  });

  it('honours labelColumnRatio / minLabelColumnWidth, and rejects non-finite values rather than painting NaN', () => {
    stubMatchMedia(true);
    stubResizeObserver();
    setClientWidth(container, 400);

    const tuned = responsive({ labelColumnRatio: 0.25, minLabelColumnWidth: 40 });
    tuned.mount(container);
    expect(tuned.getLabelColumnWidth()).toBe(100);
    tuned.destroy();

    const other = document.createElement('div');
    document.body.appendChild(other);
    setClientWidth(other, 400);
    const poisoned = responsive({ labelColumnRatio: Number.NaN });
    poisoned.mount(other);
    expect(poisoned.getLabelColumnWidth()).toBe(160); // 0.4 default, ceilinged
    expect(Number.isFinite(poisoned.getLabelColumnWidth())).toBe(true);
    poisoned.destroy();
    other.remove();
  });
});

describe('withResponsive — the pan recognizer (touch arbitration)', () => {
  /** Dispatches a real `PointerEvent`-shaped event. jsdom has no `PointerEvent` constructor, so a
   *  `MouseEvent` carrying `pointerId`/`pointerType` is used — the mixin only reads those fields
   *  plus `clientX`/`clientY`/`target`. */
  function pointer(type: string, target: Element, x: number, y: number, id = 1): void {
    const ev = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
    Object.defineProperty(ev, 'pointerId', { value: id });
    Object.defineProperty(ev, 'pointerType', { value: 'touch' });
    target.dispatchEvent(ev);
  }

  function mountWithScroll() {
    stubMatchMedia(true);
    stubResizeObserver();
    const gantt = responsive();
    gantt.mount(container);
    // jsdom never scrolls anything; back scrollLeft/scrollTop with real storage so the pan's
    // writes are observable.
    let left = 500;
    let top = 100;
    Object.defineProperty(container, 'scrollLeft', {
      get: () => left,
      set: (v: number) => {
        left = v;
      },
      configurable: true,
    });
    Object.defineProperty(container, 'scrollTop', {
      get: () => top,
      set: (v: number) => {
        top = v;
      },
      configurable: true,
    });
    return { gantt, svg: container.querySelector('svg')! };
  }

  it('a drag on the chart BACKGROUND pans the container, inverted like every native scroller', () => {
    const { svg } = mountWithScroll();
    const grid = svg.querySelector('.fg-timeline__row') ?? svg;

    pointer('pointerdown', grid, 300, 400);
    pointer('pointermove', grid, 250, 380); // finger moves left/up by 50/20
    // Content dragged left => scrolled forward.
    expect(container.scrollLeft).toBe(550);
    expect(container.scrollTop).toBe(120);

    // Absolute deltas from the gesture START, not accumulated increments — a dropped move costs
    // nothing instead of drifting.
    pointer('pointermove', grid, 200, 400);
    expect(container.scrollLeft).toBe(600);
    expect(container.scrollTop).toBe(100);

    pointer('pointerup', grid, 200, 400);
    pointer('pointermove', grid, 100, 400); // after the gesture ends: ignored
    expect(container.scrollLeft).toBe(600);
  });

  it('a drag that STARTS on a task bar is left entirely alone, so pointer-drag.ts can claim it', () => {
    const { svg } = mountWithScroll();
    const bar = svg.querySelector('.fg-task[data-task-id]')!;
    expect(bar).not.toBeNull();

    pointer('pointerdown', bar, 300, 400);
    pointer('pointermove', bar, 250, 380);
    // Not panned — this is the load-bearing assertion of the whole arbitration design.
    expect(container.scrollLeft).toBe(500);
    expect(container.scrollTop).toBe(100);
  });

  it('a pointerdown on a bar CHILD (the rendered rect/label) is also declined, via closest()', () => {
    const { svg } = mountWithScroll();
    const barChild = svg.querySelector('.fg-task[data-task-id] *');
    // Guard rather than assume: if the bar ever renders childless, this test would silently pass.
    expect(barChild).not.toBeNull();

    pointer('pointerdown', barChild!, 300, 400);
    pointer('pointermove', barChild!, 250, 380);
    expect(container.scrollLeft).toBe(500);
  });

  it('pointercancel ends the gesture like pointerup, and a second pointer cannot hijack a live pan', () => {
    const { svg } = mountWithScroll();
    const grid = svg.querySelector('.fg-timeline__row') ?? svg;

    pointer('pointerdown', grid, 300, 400, 1);
    pointer('pointerdown', grid, 100, 100, 2); // second finger — ignored, pan 1 still owns it
    pointer('pointermove', grid, 250, 400, 2); // wrong pointerId — ignored
    expect(container.scrollLeft).toBe(500);
    pointer('pointermove', grid, 250, 400, 1);
    expect(container.scrollLeft).toBe(550);

    pointer('pointercancel', grid, 250, 400, 1);
    pointer('pointermove', grid, 100, 400, 1);
    expect(container.scrollLeft).toBe(550);
  });
});

describe('withResponsive — lifecycle', () => {
  it('destroy() hands the container back as it was found: no stylesheet, no touch-action, observer disconnected, listeners detached', () => {
    stubMatchMedia(true);
    const ro = stubResizeObserver();
    const gantt = responsive();
    gantt.mount(container);
    expect(styleEl(container)).not.toBeNull();

    gantt.destroy();

    // The stylesheet is the ONLY thing suppressing `touch-action`, so its removal is what hands
    // native scrolling back — nothing is left inline on the container to unwind.
    expect(styleEl(container)).toBeNull();
    expect(container.getAttribute('style') ?? '').not.toContain('touch-action');
    expect(ro.instances.every((i) => i.disconnected)).toBe(true);
  });

  it('destroy() unsubscribes from matchMedia and is idempotent', () => {
    const media = stubMatchMedia(true);
    stubResizeObserver();
    const gantt = responsive();
    gantt.mount(container);
    expect(media.listenerCount).toBe(1);

    gantt.destroy();
    expect(media.listenerCount).toBe(0);
    expect(() => gantt.destroy()).not.toThrow();
  });

  it('a REMOUNT re-installs on the new nodes and leaves nothing on the old ones', () => {
    stubMatchMedia(true);
    stubResizeObserver();
    const gantt = responsive();
    gantt.mount(container);

    gantt.unmount();
    const second = document.createElement('div');
    document.body.appendChild(second);
    gantt.mount(second);

    expect(styleEl(second)).not.toBeNull();
    expectDensity(second, 'touch');
    expect(styleEl(container)).toBeNull();
    // Exactly one stylesheet across both containers — no leak per mount. Load-bearing: the rule
    // is document-global, so a leaked copy would keep suppressing `touch-action` on the old
    // container forever.
    expect(document.querySelectorAll('style[data-fg-responsive]').length).toBe(1);
    second.remove();
  });

  it('headless-safe: no matchMedia and no ResizeObserver at all — mounts, degrades to desktop, never throws', () => {
    // Deliberately stubbing NEITHER: this is jsdom's real state and a plausible runtime.
    expect(typeof matchMedia).toBe('undefined');
    const gantt = responsive();
    expect(() => gantt.mount(container)).not.toThrow();

    expect(gantt.isCoarsePointer()).toBe(false);
    expect(gantt.getLabelColumnWidth()).toBe(160);
    expect(styleEl(container)).toBeNull();
    expect(() => gantt.destroy()).not.toThrow();
  });

  it('is safe to apply before a mount ever happens, and to destroy while unmounted', () => {
    stubMatchMedia(true);
    stubResizeObserver();
    const gantt = responsive();
    expect(gantt.isCoarsePointer()).toBe(true);
    expect(gantt.getLabelColumnWidth()).toBe(160);
    expect(() => gantt.destroy()).not.toThrow();
  });
});
