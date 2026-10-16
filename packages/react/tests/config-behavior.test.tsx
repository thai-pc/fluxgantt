// Per-field behavior with the REAL core (no createGantt spy): each forwarded field has an
// observable effect on the mounted chart. `canvasViewportHeight` has no jsdom-observable effect
// (Canvas mode needs >= 2000 tasks and a real browser); it is covered by the identity assertion
// in config-passthrough.test.tsx.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { StrictMode, createRef, type CSSProperties } from 'react';
import { render, renderHook } from '@testing-library/react';
import { computeRollup, toTaskId } from '@fluxgantt/core';
import type { TaskInput } from '@fluxgantt/core';
import { FluxGantt } from '../src/FluxGantt.js';
import { useFluxGantt } from '../src/use-flux-gantt.js';
import type { FluxGanttProps, FluxGanttRef } from '../src/types.js';

function t(id: string, start: string, end: string, extra: Partial<TaskInput> = {}): TaskInput {
  return { id: toTaskId(id), name: id, start, end, progress: 0, type: 'task', ...extra };
}
const A = toTaskId('a');
const B = toTaskId('b');
const TWO = [t('a', '2026-01-05T09:00', '2026-01-06T09:00'), t('b', '2026-01-06T10:00', '2026-01-07T10:00')];
const FS = [{ from: A, to: B, type: 'FS' as const }];

function mountChart(props: FluxGanttProps) {
  const ref = createRef<FluxGanttRef>();
  const utils = render(<FluxGantt ref={ref} {...props} />);
  return { ref, ...utils, container: utils.container.firstElementChild as HTMLElement };
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
});

describe('<FluxGantt> forwarded config fields', () => {
  it('ariaLabel names the chart', () => {
    const { container } = mountChart({ tasks: TWO, ariaLabel: 'My plan' });
    expect(container.querySelector('svg')?.getAttribute('aria-label')).toBe('My plan');
  });

  it('messages.taskLabel builds the bar accessible name', () => {
    const { container } = mountChart({ tasks: TWO, messages: { taskLabel: (p) => `TRANSLATED ${p.name}` } });
    expect(container.querySelector('.fg-task[data-task-id="a"]')?.getAttribute('aria-label')).toBe('TRANSLATED a');
  });

  it("schedulingMode 'auto' cascades a dependent on move; default does not", () => {
    const auto = mountChart({ tasks: TWO, dependencies: FS, schedulingMode: 'auto' });
    const before = auto.ref.current!.getTask(B)!.start.toString();
    auto.ref.current!.moveTask(A, '2026-01-12T09:00');
    expect(auto.ref.current!.getTask(B)!.start.toString()).not.toBe(before);
    auto.unmount();

    const manual = mountChart({ tasks: TWO, dependencies: FS });
    const manualBefore = manual.ref.current!.getTask(B)!.start.toString();
    manual.ref.current!.moveTask(A, '2026-01-12T09:00');
    expect(manual.ref.current!.getTask(B)!.start.toString()).toBe(manualBefore);
  });

  it('historyLimit 0 disables undo; 1 keeps one entry', () => {
    const off = mountChart({ tasks: TWO, historyLimit: 0 });
    off.ref.current!.moveTask(A, '2026-01-12T09:00');
    expect(off.ref.current!.canUndo()).toBe(false);
    off.unmount();

    const one = mountChart({ tasks: TWO, historyLimit: 1 });
    one.ref.current!.moveTask(A, '2026-01-12T09:00');
    one.ref.current!.moveTask(A, '2026-01-13T09:00');
    one.ref.current!.undo();
    expect(one.ref.current!.canUndo()).toBe(false);
  });

  it('an invalid historyLimit throws the wrapped initial-config error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const historyLimit of [-1, 1.5]) {
      expect(() => renderHook(() => useFluxGantt({ tasks: TWO, historyLimit }))).toThrow(
        /\[@fluxgantt\/react\] invalid initial config/,
      );
    }
  });

  it('initialCollapsed collapses a parent and silently drops unknown ids', () => {
    const tasks = [
      t('p', '2026-01-05T09:00', '2026-01-09T09:00'),
      t('c', '2026-01-05T09:00', '2026-01-06T09:00', { parent: toTaskId('p') }),
    ];
    const { ref, container } = mountChart({
      tasks,
      initialCollapsed: [toTaskId('p'), toTaskId('ghost')],
    });
    expect(ref.current!.isCollapsed(toTaskId('p'))).toBe(true);
    expect(container.querySelector('.fg-task[data-task-id="c"]')).toBeNull();
  });

  it('rollup draws a parent at its rolled-up span; absent, it does not', () => {
    const tasks = [
      t('p', '2026-01-05T09:00', '2026-01-06T09:00'),
      t('c', '2026-01-07T09:00', '2026-01-09T09:00', { parent: toTaskId('p') }),
    ];
    const on = mountChart({ tasks, rollup: computeRollup });
    expect(on.container.querySelector('.fg-task[data-task-id="p"]')?.getAttribute('data-rolled-up')).toBe('true');
    on.unmount();
    const off = mountChart({ tasks });
    expect(off.container.querySelector('.fg-task[data-task-id="p"]')?.hasAttribute('data-rolled-up')).toBe(false);
  });
});

describe('<FluxGantt> theme', () => {
  const DARK_PROP = '--fg-bg';

  it('defaults to light even when the OS prefers dark', () => {
    stubDarkPreference(true);
    const { ref, container } = mountChart({ tasks: TWO });
    expect(ref.current!.getResolvedTheme()).toBe('light');
    expect(container.style.getPropertyValue(DARK_PROP)).toBe('');
  });

  it("theme 'dark' sets --fg-* on the container; rerender to 'light' removes them", () => {
    const ref = createRef<FluxGanttRef>();
    const { container, rerender } = render(<FluxGantt ref={ref} tasks={TWO} theme="dark" />);
    const host = container.firstElementChild as HTMLElement;
    expect(host.style.length).toBeGreaterThan(0);
    expect(ref.current!.getResolvedTheme()).toBe('dark');

    rerender(<FluxGantt ref={ref} tasks={TWO} theme="light" />);
    expect(host.style.length).toBe(0);
    expect(ref.current!.getTheme()).toBe('light');
  });

  it("theme 'auto' follows a dark OS preference", () => {
    stubDarkPreference(true);
    const { ref } = mountChart({ tasks: TWO, theme: 'auto' });
    expect(ref.current!.getResolvedTheme()).toBe('dark');
  });

  it('StrictMode double effect run is harmless and the final theme is correct', () => {
    const ref = createRef<FluxGanttRef>();
    const { container, rerender } = render(
      <StrictMode>
        <FluxGantt ref={ref} tasks={TWO} theme="dark" />
      </StrictMode>,
    );
    expect(ref.current!.getResolvedTheme()).toBe('dark');
    rerender(
      <StrictMode>
        <FluxGantt ref={ref} tasks={TWO} theme="light" />
      </StrictMode>,
    );
    expect(ref.current!.getResolvedTheme()).toBe('light');
    expect((container.firstElementChild as HTMLElement).style.length).toBe(0);
  });

  it('unmount removes the host-visible theme state it armed: no leaked matchMedia listener', () => {
    const { listeners, mql } = stubDarkPreference(true);
    const { unmount } = render(<FluxGantt tasks={TWO} theme="auto" />);
    expect(listeners.size).toBe(1);
    unmount();
    expect(listeners.size).toBe(0);
    expect(mql.removeEventListener).toHaveBeenCalled();
  });

  it('StrictMode: theme="auto" leaves no leaked listener after unmount', () => {
    const { listeners } = stubDarkPreference(true);
    const { unmount } = render(
      <StrictMode>
        <FluxGantt tasks={TWO} theme="auto" />
      </StrictMode>,
    );
    expect(listeners.size).toBe(1); // the one live, mounted instance
    unmount();
    expect(listeners.size).toBe(0);
  });

  it('an effect-only hook run with no container leaves no listener', () => {
    const { listeners } = stubDarkPreference(true);
    renderHook(() => useFluxGantt({ tasks: TWO, theme: 'auto' })).unmount();
    expect(listeners.size).toBe(0);
  });

  it("runtime change to 'auto' follows the OS; 'dark' back to unset resolves to light", () => {
    stubDarkPreference(true);
    const ref = createRef<FluxGanttRef>();
    const { container, rerender } = render(<FluxGantt ref={ref} tasks={TWO} />);
    expect(ref.current!.getResolvedTheme()).toBe('light');
    rerender(<FluxGantt ref={ref} tasks={TWO} theme="auto" />);
    expect(ref.current!.getResolvedTheme()).toBe('dark');
    rerender(<FluxGantt ref={ref} tasks={TWO} theme="dark" />);
    rerender(<FluxGantt ref={ref} tasks={TWO} />);
    expect(ref.current!.getTheme()).toBe('light');
    expect((container.firstElementChild as HTMLElement).style.length).toBe(0);
  });

  it('host inline --fg-* overrides survive mount in light, a dark/light toggle and a re-render', () => {
    const ref = createRef<FluxGanttRef>();
    const style = { '--fg-bg': '#123456' } as CSSProperties;
    const { container, rerender } = render(<FluxGantt ref={ref} tasks={TWO} style={style} />);
    const host = container.firstElementChild as HTMLElement;
    expect(host.style.getPropertyValue('--fg-bg')).toBe('#123456');
    rerender(<FluxGantt ref={ref} tasks={TWO} style={style} theme="dark" />);
    rerender(<FluxGantt ref={ref} tasks={TWO} style={style} theme="light" />);
    expect(host.style.getPropertyValue('--fg-bg')).toBe('#123456');
  });

  it('unmount hands the container back with the host inline --fg-bg, not the dark token', () => {
    const style = { '--fg-bg': '#123456' } as CSSProperties;
    const { container, unmount } = render(<FluxGantt tasks={TWO} style={style} theme="dark" />);
    const host = container.firstElementChild as HTMLElement;
    expect(host.style.getPropertyValue('--fg-bg')).not.toBe('#123456');
    unmount();
    expect(host.style.getPropertyValue('--fg-bg')).toBe('#123456');
  });

  it('instance.unmount() while still rendered restores the host inline --fg-bg (core path only)', () => {
    const ref = createRef<FluxGanttRef>();
    const style = { '--fg-bg': '#123456' } as CSSProperties;
    const { container } = render(<FluxGantt ref={ref} tasks={TWO} style={style} theme="dark" />);
    const host = container.firstElementChild as HTMLElement;
    expect(host.style.getPropertyValue('--fg-bg')).not.toBe('#123456');
    ref.current!.unmount();
    expect(host.style.getPropertyValue('--fg-bg')).toBe('#123456');
  });

  it('a theme change after ref.destroy() does not throw', () => {
    const ref = createRef<FluxGanttRef>();
    const { rerender } = render(<FluxGantt ref={ref} tasks={TWO} />);
    ref.current!.destroy();
    expect(() => rerender(<FluxGantt ref={ref} tasks={TWO} theme="dark" />)).not.toThrow();
  });

  it('exposes ThemeCapability on the ref and rejects an unknown theme at compile time', () => {
    const { ref } = mountChart({ tasks: TWO });
    expect(typeof ref.current!.setTheme).toBe('function');
    // @ts-expect-error 'blue' is not a valid theme
    const bad: FluxGanttProps = { theme: 'blue' };
    expect(bad).toBeDefined();
  });
});
