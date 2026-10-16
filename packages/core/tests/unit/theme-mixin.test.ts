// @vitest-environment jsdom
//
// `withTheme()` tests (spec §7.6 / §8.2). Runs under jsdom (per-file override, matching
// gantt-dom.test.ts) because the whole feature is "write custom properties onto a real mount
// container" — there is nothing to assert without a DOM.
//
// jsdom ships NO `matchMedia`, which is itself one of the cases under test (the mixin must
// degrade to light rather than throw). The `'auto'` tests install an explicit stub, so the
// preference is driven deterministically rather than inherited from the machine running CI.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGantt as createGanttBase } from '../../src/gantt.js';
import { withRender, CANVAS_AUTO_SWITCH_THRESHOLD } from '../../src/render/mixin.js';
import { withInteraction } from '../../src/interaction/mixin.js';
import { withTheme } from '../../src/theme/mixin.js';
import { DARK_TOKENS } from '../../src/theme/tokens.js';
import { toTaskId } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';

const TASKS: readonly TaskInput[] = [
  { id: toTaskId('t1'), name: 'Task 1', start: '2026-01-05', end: '2026-01-09', progress: 0, type: 'task' },
];

const TOKEN_KEYS = Object.keys(DARK_TOKENS);

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
  vi.unstubAllGlobals();
});

function themed(config: Parameters<typeof createGanttBase>[0] = {}) {
  return withTheme(withRender(createGanttBase({ tasks: TASKS, ...config })));
}

/** Minimal `MediaQueryList` stub with a working listener set, so a preference FLIP can be
 *  simulated the way a real OS theme change fires it. */
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  const mql = {
    matches,
    media: '(prefers-color-scheme: dark)',
    addEventListener: vi.fn((_: string, fn: () => void) => listeners.add(fn)),
    removeEventListener: vi.fn((_: string, fn: () => void) => listeners.delete(fn)),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => mql),
  );
  return {
    mql,
    /** Flips the preference and fires `change`, exactly as a real OS switch would. */
    flip(next: boolean): void {
      mql.matches = next;
      for (const fn of listeners) fn();
    },
    get listenerCount(): number {
      return listeners.size;
    },
  };
}

/** How many of the dark tokens are currently set inline on the container. */
function darkTokenCount(el: HTMLElement): number {
  return TOKEN_KEYS.filter((k) => el.style.getPropertyValue(k) !== '').length;
}

describe('withTheme — applying tokens to the mount container', () => {
  it("setTheme('dark') sets every DARK_TOKENS entry inline on the container", () => {
    const gantt = themed();
    gantt.mount(container);
    gantt.setTheme('dark');

    for (const [key, value] of Object.entries(DARK_TOKENS)) {
      expect(container.style.getPropertyValue(key)).toBe(value);
    }
    expect(darkTokenCount(container)).toBe(TOKEN_KEYS.length);
  });

  it("setTheme('light') removes them all, leaving no residue", () => {
    const gantt = themed();
    gantt.mount(container);
    gantt.setTheme('dark');
    gantt.setTheme('light');

    expect(darkTokenCount(container)).toBe(0);
    // Not just empty-valued — the declarations are gone from the inline style entirely, so the
    // renderer's own `var(--fg-x, <light fallback>)` resolves to its fallback again.
    expect(container.getAttribute('style') ?? '').not.toContain('--fg-');
  });

  it('writes the tokens on the CONTAINER, not on the <svg> the renderer appends', () => {
    // Load-bearing: the renderer rebuilds its `<svg>` children on every repaint, so tokens
    // written there would vanish; the container is the host element the renderer never clears.
    const gantt = themed();
    gantt.mount(container);
    gantt.setTheme('dark');

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.style.getPropertyValue('--fg-bg')).toBe('');
    expect(container.style.getPropertyValue('--fg-bg')).toBe(DARK_TOKENS['--fg-bg']);
  });

  it('survives a repaint — the renderer clearing its own children does not drop the tokens', () => {
    const gantt = themed();
    gantt.mount(container);
    gantt.setTheme('dark');
    gantt.zoomTo('month'); // forces a full re-render

    expect(darkTokenCount(container)).toBe(TOKEN_KEYS.length);
  });

  it('re-applies on a REMOUNT into a fresh container', () => {
    const gantt = themed();
    gantt.mount(container);
    gantt.setTheme('dark');

    const second = document.createElement('div');
    document.body.appendChild(second);
    gantt.mount(second); // implicit unmount + remount

    expect(darkTokenCount(second)).toBe(TOKEN_KEYS.length);
    expect(darkTokenCount(container)).toBe(0); // A handed back clean
    second.remove();
  });
});

describe('withTheme — getTheme / getResolvedTheme', () => {
  it('defaults to auto, resolving light where matchMedia is absent', () => {
    // jsdom provides no `matchMedia` at all — the degrade-quietly path.
    const gantt = themed();
    expect(gantt.getTheme()).toBe('auto');
    expect(gantt.getResolvedTheme()).toBe('light');
  });

  it('seeds itself from config.theme', () => {
    const gantt = themed({ theme: 'dark' });
    expect(gantt.getTheme()).toBe('dark');
    expect(gantt.getResolvedTheme()).toBe('dark');
  });

  it('getTheme() reports the CONFIGURED name while getResolvedTheme() reports the painted one', () => {
    stubMatchMedia(true);
    const gantt = themed({ theme: 'auto' });
    expect(gantt.getTheme()).toBe('auto');
    expect(gantt.getResolvedTheme()).toBe('dark');
  });

  it('applies dark at mount time when config.theme was dark before mounting', () => {
    const gantt = themed({ theme: 'dark' });
    expect(darkTokenCount(container)).toBe(0); // nothing mounted yet
    gantt.mount(container);
    expect(darkTokenCount(container)).toBe(TOKEN_KEYS.length);
  });
});

describe("withTheme — 'auto' follows prefers-color-scheme", () => {
  it('resolves dark when the OS prefers dark', () => {
    stubMatchMedia(true);
    const gantt = themed();
    gantt.mount(container);
    expect(gantt.getResolvedTheme()).toBe('dark');
    expect(darkTokenCount(container)).toBe(TOKEN_KEYS.length);
  });

  it('re-applies when the OS preference FLIPS, with no setTheme() call', () => {
    const media = stubMatchMedia(false);
    const gantt = themed();
    gantt.mount(container);
    expect(darkTokenCount(container)).toBe(0);

    media.flip(true);
    expect(gantt.getResolvedTheme()).toBe('dark');
    expect(darkTokenCount(container)).toBe(TOKEN_KEYS.length);

    media.flip(false);
    expect(gantt.getResolvedTheme()).toBe('light');
    expect(darkTokenCount(container)).toBe(0);
  });

  it('stops following the OS once an explicit theme is chosen', () => {
    const media = stubMatchMedia(false);
    const gantt = themed();
    gantt.mount(container);
    gantt.setTheme('light');
    expect(media.listenerCount).toBe(0);

    media.flip(true); // OS goes dark — the explicit choice must win
    expect(gantt.getResolvedTheme()).toBe('light');
    expect(darkTokenCount(container)).toBe(0);
  });

  it('resumes following the OS when switched back to auto', () => {
    const media = stubMatchMedia(true);
    const gantt = themed();
    gantt.mount(container);
    gantt.setTheme('light');
    gantt.setTheme('auto');

    expect(gantt.getResolvedTheme()).toBe('dark');
    expect(media.listenerCount).toBe(1);
  });

  it('registers exactly ONE listener even across repeated auto-relevant calls', () => {
    const media = stubMatchMedia(false);
    const gantt = themed();
    gantt.mount(container);
    gantt.setTheme('dark');
    gantt.setTheme('auto');
    gantt.setTheme('dark');
    gantt.setTheme('auto');
    expect(media.listenerCount).toBe(1);
  });
});

describe('withTheme — validation and lifecycle', () => {
  it('throws on an unknown theme name', () => {
    const gantt = themed();
    expect(() => gantt.setTheme('sepia' as never)).toThrow(/invalid theme/);
  });

  it('is a silent no-op when the theme is unchanged', () => {
    const gantt = themed();
    gantt.mount(container);
    gantt.setTheme('dark');
    container.style.setProperty('--fg-bg', 'sentinel');
    gantt.setTheme('dark'); // unchanged — must not re-apply
    expect(container.style.getPropertyValue('--fg-bg')).toBe('sentinel');
  });

  it('setTheme() throws after destroy(), while the getters stay safe', () => {
    const gantt = themed();
    gantt.mount(container);
    gantt.setTheme('dark');
    gantt.destroy();

    expect(() => gantt.setTheme('light')).toThrow();
    expect(() => gantt.getTheme()).not.toThrow();
    expect(gantt.getTheme()).toBe('dark');
    expect(gantt.getResolvedTheme()).toBe('dark');
  });

  it('destroy() removes the media listener', () => {
    const media = stubMatchMedia(false);
    const gantt = themed();
    gantt.mount(container);
    expect(media.listenerCount).toBe(1);
    gantt.destroy();
    expect(media.listenerCount).toBe(0);
  });

  it('destroy() hands the container back clean — no leftover custom properties', () => {
    // The container belongs to the HOST; a destroyed chart must not keep retheming whatever
    // the host renders there next.
    const gantt = themed();
    gantt.mount(container);
    gantt.setTheme('dark');
    expect(darkTokenCount(container)).toBe(TOKEN_KEYS.length);

    gantt.destroy();
    expect(darkTokenCount(container)).toBe(0);
  });

  it('destroy() is idempotent', () => {
    const media = stubMatchMedia(false);
    const gantt = themed();
    gantt.mount(container);
    gantt.destroy();
    expect(() => gantt.destroy()).not.toThrow();
    expect(media.listenerCount).toBe(0);
  });

  it('an OS flip after destroy() does nothing', () => {
    const media = stubMatchMedia(false);
    const gantt = themed();
    gantt.mount(container);
    gantt.destroy();
    media.flip(true);
    expect(darkTokenCount(container)).toBe(0);
  });

  it('refuses to attach to something that is not a createGantt() instance', () => {
    expect(() => withTheme({} as never)).toThrow(/has no internal state/);
  });
});

describe('withTheme — construction-time validation', () => {
  it('throws on an unknown config.theme instead of silently painting light', () => {
    expect(() => themed({ theme: 'blue' as never })).toThrow(/invalid theme "blue"/);
  });
});

describe('withTheme — host inline --fg-* overrides', () => {
  it('survives mounting in light (never darkened = no-op)', () => {
    container.style.setProperty('--fg-bg', '#123456');
    const gantt = themed({ theme: 'light' });
    gantt.mount(container);
    expect(container.style.getPropertyValue('--fg-bg')).toBe('#123456');
  });

  it('survives a dark to light switch when the host value was overwritten', () => {
    container.style.setProperty('--fg-bg', '#123456');
    const gantt = themed();
    gantt.mount(container);
    gantt.setTheme('dark');
    expect(container.style.getPropertyValue('--fg-bg')).toBe(DARK_TOKENS['--fg-bg']);
    gantt.setTheme('light');
    expect(container.style.getPropertyValue('--fg-bg')).toBe('#123456');
    // Every token we wrote that had no prior value is gone.
    expect(darkTokenCount(container)).toBe(1);
  });

  it('restores the host value (and priority) on destroy', () => {
    container.style.setProperty('--fg-bg', '#123456', 'important');
    const gantt = themed({ theme: 'dark' });
    gantt.mount(container);
    expect(container.style.getPropertyValue('--fg-bg')).toBe(DARK_TOKENS['--fg-bg']);
    gantt.destroy();
    expect(container.style.getPropertyValue('--fg-bg')).toBe('#123456');
    expect(container.style.getPropertyPriority('--fg-bg')).toBe('important');
    expect(darkTokenCount(container)).toBe(1);
  });

  it('re-applying dark on a remount does not capture our own values as the host value', () => {
    container.style.setProperty('--fg-bg', '#123456');
    const gantt = themed({ theme: 'dark' });
    gantt.mount(container);
    gantt.unmount();
    gantt.mount(container);
    gantt.setTheme('light');
    expect(container.style.getPropertyValue('--fg-bg')).toBe('#123456');
  });
});

describe('withTheme — composition', () => {
  it('works when applied BEFORE withRender', () => {
    // Order-independence is the facade split's contract (spec-facade-split.md §2.2) — this
    // mixin must not capture the container eagerly at application time.
    const gantt = withRender(withTheme(createGanttBase({ tasks: TASKS })));
    gantt.mount(container);
    gantt.setTheme('dark');
    expect(darkTokenCount(container)).toBe(TOKEN_KEYS.length);
  });

  it('works when applied AFTER withRender', () => {
    const gantt = withTheme(withRender(createGanttBase({ tasks: TASKS })));
    gantt.mount(container);
    gantt.setTheme('dark');
    expect(darkTokenCount(container)).toBe(TOKEN_KEYS.length);
  });

  it('is usable headless — setTheme() without withRender neither throws nor paints', () => {
    const gantt = withTheme(createGanttBase({ tasks: TASKS }));
    expect(() => gantt.setTheme('dark')).not.toThrow();
    expect(gantt.getResolvedTheme()).toBe('dark');
    expect(darkTokenCount(container)).toBe(0);
  });
});

describe('DARK_TOKENS', () => {
  it('is frozen — a host cannot mutate the shared table', () => {
    expect(Object.isFrozen(DARK_TOKENS)).toBe(true);
  });

  it('holds only literal hex colors, never a url()/expression/javascript: payload', () => {
    // These values go straight into `style.setProperty` without passing through
    // `validateTaskColor`, which is only sound while every one of them is an authored literal
    // (security.md §1/§6). This test is the guard on that invariant.
    for (const value of Object.values(DARK_TOKENS)) {
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('names only tokens a renderer actually reads — the non-`-dark` spellings', () => {
    for (const key of TOKEN_KEYS) {
      expect(key).toMatch(/^--fg-/);
      expect(key.endsWith('-dark')).toBe(false);
    }
  });
});

describe('withTheme — unmount() restores the host container', () => {
  it('removes every token we wrote when the host had none', () => {
    const gantt = themed({ theme: 'dark' });
    gantt.mount(container);
    expect(darkTokenCount(container)).toBe(TOKEN_KEYS.length);
    gantt.unmount();
    expect(darkTokenCount(container)).toBe(0);
    expect(gantt.getTheme()).toBe('dark');
  });

  it('restores the host value and priority of an overwritten token', () => {
    container.style.setProperty('--fg-bg', '#123456', 'important');
    const gantt = themed({ theme: 'dark' });
    gantt.mount(container);
    gantt.unmount();
    expect(container.style.getPropertyValue('--fg-bg')).toBe('#123456');
    expect(container.style.getPropertyPriority('--fg-bg')).toBe('important');
    expect(darkTokenCount(container)).toBe(1);
  });

  it('removes the listener and the tokens when unmounted while auto-resolved-dark', () => {
    const media = stubMatchMedia(true);
    const gantt = themed();
    gantt.mount(container);
    expect(media.listenerCount).toBe(1);
    gantt.unmount();
    expect(media.listenerCount).toBe(0);
    expect(darkTokenCount(container)).toBe(0);
  });

  it('writes nothing and leaves host values alone when unmounted while light', () => {
    container.style.setProperty('--fg-bg', '#123456');
    const gantt = themed({ theme: 'light' });
    gantt.mount(container);
    const set = vi.spyOn(container.style, 'setProperty');
    const remove = vi.spyOn(container.style, 'removeProperty');
    gantt.unmount();
    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(container.style.getPropertyValue('--fg-bg')).toBe('#123456');
  });

  it('re-darkens a remount of the same element and later restores the HOST value', () => {
    container.style.setProperty('--fg-bg', '#123456');
    const gantt = themed({ theme: 'dark' });
    gantt.mount(container);
    gantt.unmount();
    expect(container.style.getPropertyValue('--fg-bg')).toBe('#123456');
    gantt.mount(container);
    expect(container.style.getPropertyValue('--fg-bg')).toBe(DARK_TOKENS['--fg-bg']);
    gantt.setTheme('light');
    expect(container.style.getPropertyValue('--fg-bg')).toBe('#123456');
    expect(darkTokenCount(container)).toBe(1);
  });

  it('mount A -> unmount -> mount B leaves A clean and B dark', () => {
    const gantt = themed({ theme: 'dark' });
    const second = document.createElement('div');
    document.body.appendChild(second);
    gantt.mount(container);
    gantt.unmount();
    gantt.mount(second);
    expect(darkTokenCount(container)).toBe(0);
    expect(darkTokenCount(second)).toBe(TOKEN_KEYS.length);
    second.remove();
  });

  it('destroy() after unmount() neither throws nor restores twice', () => {
    const media = stubMatchMedia(true);
    const gantt = themed();
    gantt.mount(container);
    gantt.unmount();
    // A value the host writes after unmount must survive the later destroy().
    container.style.setProperty('--fg-bg', '#abcdef');
    expect(() => gantt.destroy()).not.toThrow();
    expect(container.style.getPropertyValue('--fg-bg')).toBe('#abcdef');
    expect(media.listenerCount).toBe(0);
  });

  it('auto: an OS flip while unmounted repaints nothing, is read on demand, and paints at remount', () => {
    const media = stubMatchMedia(false);
    const gantt = themed();
    gantt.mount(container);
    gantt.unmount();
    media.flip(true);
    expect(darkTokenCount(container)).toBe(0);
    expect(media.listenerCount).toBe(0);
    expect(gantt.getResolvedTheme()).toBe('dark');
    gantt.mount(container);
    expect(darkTokenCount(container)).toBe(TOKEN_KEYS.length);
    expect(media.listenerCount).toBe(1);
  });

  it('setTheme() after unmount stores the choice without touching the container', () => {
    const gantt = themed({ theme: 'light' });
    gantt.mount(container);
    gantt.unmount();
    expect(() => gantt.setTheme('dark')).not.toThrow();
    expect(darkTokenCount(container)).toBe(0);
    gantt.mount(container);
    expect(darkTokenCount(container)).toBe(TOKEN_KEYS.length);
  });

  it('keeps add/removeEventListener balanced across mount/unmount/mount/destroy', () => {
    const media = stubMatchMedia(true);
    const gantt = themed();
    gantt.mount(container);
    gantt.unmount();
    gantt.mount(container);
    gantt.destroy();
    expect(media.listenerCount).toBe(0);
    const added = media.mql.addEventListener.mock.calls.length;
    const removed = media.mql.removeEventListener.mock.calls.length;
    expect(added).toBe(2);
    expect(removed).toBeGreaterThanOrEqual(added);
  });

  it('coexists with withInteraction\'s own handle.destroy wrap across unmount/remount', () => {
    for (const compose of [
      () => withTheme(withInteraction(withRender(createGanttBase({ tasks: TASKS, theme: 'dark' })))),
      () => withInteraction(withTheme(withRender(createGanttBase({ tasks: TASKS, theme: 'dark' })))),
    ]) {
      const gantt = compose();
      gantt.mount(container);
      expect(darkTokenCount(container)).toBe(TOKEN_KEYS.length);
      gantt.unmount();
      expect(darkTokenCount(container)).toBe(0);
      expect(container.querySelector('svg')).toBeNull();
      gantt.mount(container);
      expect(darkTokenCount(container)).toBe(TOKEN_KEYS.length);
      expect(container.querySelectorAll('svg').length).toBe(1);
      gantt.destroy();
      expect(darkTokenCount(container)).toBe(0);
      expect(container.querySelector('svg')).toBeNull();
    }
  });
});

describe('withTheme — unmount() on the async Canvas path', () => {
  const HEAVY = 60_000;
  function manyTasks(n: number): TaskInput[] {
    const out: TaskInput[] = [];
    for (let i = 0; i < n; i++) {
      out.push({ id: toTaskId(`c${i}`), name: `c${i}`, start: '2026-01-05T09:00', end: '2026-01-05T17:00', progress: 0, type: 'task' });
    }
    return out;
  }
  function mockCanvas(): void {
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, k) => (k in t ? t[k as string] : (): void => {}),
      set: (t, k, v) => ((t[k as string] = v), true),
    }) as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as never);
  }
  // `vi.restoreAllMocks()` in a test body is skipped when an assertion throws, leaking the
  // `getContext` spy into later tests; core's vitest config has no `restoreMocks`.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it(
    'unmount clears the tokens of a Canvas mount',
    async () => {
      mockCanvas();
      const gantt = themed({ theme: 'dark', tasks: manyTasks(CANVAS_AUTO_SWITCH_THRESHOLD + 1) });
      const selected = vi.fn();
      gantt.on('renderer:selected', selected);
      gantt.mount(container);
      await vi.waitFor(() => expect(selected).toHaveBeenCalledTimes(1), { timeout: 30_000 });
      expect(darkTokenCount(container)).toBe(TOKEN_KEYS.length);
      gantt.unmount();
      expect(darkTokenCount(container)).toBe(0);
    },
    HEAVY,
  );

  it(
    'unmount before the async mount resolves writes nothing',
    async () => {
      mockCanvas();
      const gantt = themed({ theme: 'dark', tasks: manyTasks(CANVAS_AUTO_SWITCH_THRESHOLD + 1) });
      const selected = vi.fn();
      gantt.on('renderer:selected', selected);
      // Warm the module cache first so the mount's own dynamic import resolves on the next
      // microtasks instead of racing a cold load; then give it ample turns to (wrongly) finish.
      await import('../../src/render/canvas-renderer.js');
      gantt.mount(container);
      gantt.unmount();
      for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
      expect(selected).not.toHaveBeenCalled();
      expect(container.childElementCount).toBe(0);
      expect(darkTokenCount(container)).toBe(0);
    },
    HEAVY,
  );
});

describe('withTheme — a listener registered before the mixin unmounts inside renderer:selected', () => {
  it('does not throw or log, and leaves the container clean', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const base = withRender(createGanttBase({ tasks: TASKS, theme: 'dark' }));
      base.on('renderer:selected', () => base.unmount());
      const gantt = withTheme(base);
      gantt.mount(container);
      expect(errorSpy).not.toHaveBeenCalled();
      expect(darkTokenCount(container)).toBe(0);
      gantt.destroy();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
