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
import { withRender } from '../../src/render/mixin.js';
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
