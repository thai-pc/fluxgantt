// Per-field behavior with the REAL core (no createGantt spy). `canvasViewportHeight` has no
// jsdom-observable effect (Canvas mode needs >= 2000 tasks and a real browser); it is covered by
// the identity assertion in config-passthrough.test.ts.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { computeRollup, toTaskId } from '@fluxgantt/core';
import type { TaskInput } from '@fluxgantt/core';
import { FluxGantt } from '../src/FluxGantt.js';
import { useFluxGantt } from '../src/use-flux-gantt.js';
import type { FluxGanttRef } from '../src/types.js';

function t(id: string, start: string, end: string, extra: Partial<TaskInput> = {}): TaskInput {
  return { id: toTaskId(id), name: id, start, end, progress: 0, type: 'task', ...extra };
}
const A = toTaskId('a');
const B = toTaskId('b');
const TWO = [t('a', '2026-01-05T09:00', '2026-01-06T09:00'), t('b', '2026-01-06T10:00', '2026-01-07T10:00')];
const FS = [{ from: A, to: B, type: 'FS' as const }];

type Props = Record<string, unknown>;

function mountChart(props: Props) {
  const wrapper = mount(FluxGantt, { props, attachTo: document.body });
  const root = wrapper.element as HTMLElement;
  return { wrapper, root, ref: wrapper.vm as unknown as FluxGanttRef };
}

/** Stubs `matchMedia` with a real listener set so leaks are observable. */
function stubDarkPreference(dark: boolean) {
  const listeners = new Set<() => void>();
  const mql = {
    matches: dark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: vi.fn((_: string, fn: () => void) => listeners.add(fn)),
    removeEventListener: vi.fn((_: string, fn: () => void) => listeners.delete(fn)),
  };
  vi.stubGlobal('matchMedia', vi.fn(() => mql));
  return { mql, listeners };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('<FluxGantt> forwarded config fields', () => {
  it('ariaLabel names the chart', () => {
    const { root } = mountChart({ tasks: TWO, ariaLabel: 'My plan' });
    expect(root.querySelector('svg')?.getAttribute('aria-label')).toBe('My plan');
  });

  it('messages.taskLabel builds the bar accessible name', () => {
    const { root } = mountChart({ tasks: TWO, messages: { taskLabel: (p: { name: string }) => `TRANSLATED ${p.name}` } });
    expect(root.querySelector('.fg-task[data-task-id="a"]')?.getAttribute('aria-label')).toBe('TRANSLATED a');
  });

  it("schedulingMode 'auto' cascades a dependent on move; default does not", () => {
    const auto = mountChart({ tasks: TWO, dependencies: FS, schedulingMode: 'auto' });
    const before = auto.ref.getTask(B)!.start.toString();
    auto.ref.moveTask(A, '2026-01-12T09:00');
    expect(auto.ref.getTask(B)!.start.toString()).not.toBe(before);
    auto.wrapper.unmount();

    const manual = mountChart({ tasks: TWO, dependencies: FS });
    const manualBefore = manual.ref.getTask(B)!.start.toString();
    manual.ref.moveTask(A, '2026-01-12T09:00');
    expect(manual.ref.getTask(B)!.start.toString()).toBe(manualBefore);
  });

  it('historyLimit 0 disables undo; 1 keeps one entry', () => {
    const off = mountChart({ tasks: TWO, historyLimit: 0 });
    off.ref.moveTask(A, '2026-01-12T09:00');
    expect(off.ref.canUndo()).toBe(false);
    off.wrapper.unmount();

    const one = mountChart({ tasks: TWO, historyLimit: 1 });
    one.ref.moveTask(A, '2026-01-12T09:00');
    one.ref.moveTask(A, '2026-01-13T09:00');
    one.ref.undo();
    expect(one.ref.canUndo()).toBe(false);
  });

  it('an invalid historyLimit throws the wrapped initial-config error', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const historyLimit of [-1, 1.5]) {
      expect(() => mount(FluxGantt, { props: { tasks: TWO, historyLimit } })).toThrow(
        /\[@fluxgantt\/vue\] invalid initial config/,
      );
    }
    expect(useFluxGantt).toBeTypeOf('function');
  });

  it('initialCollapsed collapses a parent and silently drops unknown ids', () => {
    const tasks = [
      t('p', '2026-01-05T09:00', '2026-01-09T09:00'),
      t('c', '2026-01-05T09:00', '2026-01-06T09:00', { parent: toTaskId('p') }),
    ];
    const { ref, root } = mountChart({ tasks, initialCollapsed: [toTaskId('p'), toTaskId('ghost')] });
    expect(ref.isCollapsed(toTaskId('p'))).toBe(true);
    expect(root.querySelector('.fg-task[data-task-id="c"]')).toBeNull();
  });

  it('rollup draws a parent at its rolled-up span; absent, it does not', () => {
    const tasks = [
      t('p', '2026-01-05T09:00', '2026-01-06T09:00'),
      t('c', '2026-01-07T09:00', '2026-01-09T09:00', { parent: toTaskId('p') }),
    ];
    const on = mountChart({ tasks, rollup: computeRollup });
    expect(on.root.querySelector('.fg-task[data-task-id="p"]')?.getAttribute('data-rolled-up')).toBe('true');
    on.wrapper.unmount();
    const off = mountChart({ tasks });
    expect(off.root.querySelector('.fg-task[data-task-id="p"]')?.hasAttribute('data-rolled-up')).toBe(false);
  });
});

describe('<FluxGantt> theme', () => {
  it('defaults to light even when the OS prefers dark', () => {
    stubDarkPreference(true);
    const { ref, root } = mountChart({ tasks: TWO });
    expect(ref.getResolvedTheme()).toBe('light');
    expect(root.style.length).toBe(0);
  });

  it("theme 'dark' sets --fg-* on the container; setProps to 'light' removes them", async () => {
    const { wrapper, ref, root } = mountChart({ tasks: TWO, theme: 'dark' });
    expect(root.style.length).toBeGreaterThan(0);
    expect(ref.getResolvedTheme()).toBe('dark');

    await wrapper.setProps({ theme: 'light' });
    expect(root.style.length).toBe(0);
    expect(ref.getTheme()).toBe('light');
  });

  it("theme 'auto' follows a dark OS preference", () => {
    stubDarkPreference(true);
    const { ref } = mountChart({ tasks: TWO, theme: 'auto' });
    expect(ref.getResolvedTheme()).toBe('dark');
  });

  it('unmount leaves no matchMedia listener behind for theme="auto"', () => {
    const { listeners, mql } = stubDarkPreference(true);
    const { wrapper } = mountChart({ tasks: TWO, theme: 'auto' });
    expect(listeners.size).toBe(1);
    wrapper.unmount();
    expect(listeners.size).toBe(0);
    expect(mql.removeEventListener).toHaveBeenCalled();
  });

  it("runtime change to 'auto' follows the OS; 'dark' back to unset resolves to light", async () => {
    stubDarkPreference(true);
    const { wrapper, ref, root } = mountChart({ tasks: TWO });
    expect(ref.getResolvedTheme()).toBe('light');
    await wrapper.setProps({ theme: 'auto' });
    expect(ref.getResolvedTheme()).toBe('dark');
    await wrapper.setProps({ theme: 'dark' });
    await wrapper.setProps({ theme: undefined } as never);
    expect(ref.getTheme()).toBe('light');
    expect(root.style.length).toBe(0);
  });

  it('host inline --fg-* overrides survive mount in light and a dark/light toggle', async () => {
    const wrapper = mount(FluxGantt, {
      props: { tasks: TWO },
      attrs: { style: { '--fg-bg': '#123456' } },
      attachTo: document.body,
    });
    const root = wrapper.element as HTMLElement;
    expect(root.style.getPropertyValue('--fg-bg')).toBe('#123456');
    await wrapper.setProps({ theme: 'dark' });
    await wrapper.setProps({ theme: 'light' });
    expect(root.style.getPropertyValue('--fg-bg')).toBe('#123456');
  });

  it('unmount hands the container back with the host inline --fg-bg, not the dark token', () => {
    const wrapper = mount(FluxGantt, {
      props: { tasks: TWO, theme: 'dark' },
      attrs: { style: { '--fg-bg': '#123456' } },
      attachTo: document.body,
    });
    const root = wrapper.element as HTMLElement;
    expect(root.style.getPropertyValue('--fg-bg')).not.toBe('#123456');
    wrapper.unmount();
    expect(root.style.getPropertyValue('--fg-bg')).toBe('#123456');
  });

  it('a theme change after ref.destroy() does not throw', async () => {
    const { wrapper, ref } = mountChart({ tasks: TWO });
    ref.destroy();
    await expect(wrapper.setProps({ theme: 'dark' })).resolves.toBeUndefined();
  });

  it('declares a validator that rejects unknown theme names', () => {
    const validator = (FluxGantt.props as { theme: { validator: (v: string) => boolean } }).theme
      .validator;
    expect(validator('auto')).toBe(true);
    expect(validator('blue')).toBe(false);
  });

  it('exposes ThemeCapability on the ref', () => {
    const { ref } = mountChart({ tasks: TWO });
    expect(typeof ref.setTheme).toBe('function');
    expect(typeof ref.getTheme).toBe('function');
  });
});
