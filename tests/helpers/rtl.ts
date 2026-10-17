import { type Page, expect } from '@playwright/test';

// Shared helpers for the RTL specs (`examples/plain-html-demo/rtl.html`). Geometry helpers that are
// not RTL-specific (`barBox`, `taskMs`, `events`, `mouseDragTo`) live in `./canvas-drag.js` and are
// reused as-is: the fixture exposes the same `window.__fx.barBox` / `__events` / `__gantt` contract.
export { DAY_MS, PX_PER_DAY, barBox, centre, dependencyCount, events, mouseDragTo, taskMs } from './canvas-drag.js';

/** Opens the RTL fixture. `query` is e.g. `pad=2100` (Canvas) or `rtl=0` (the LTR twin). */
export async function openRtl(page: Page, query = ''): Promise<void> {
  await page.goto(`/rtl.html${query ? `?${query}` : ''}`);
  const canvas = query.includes('pad=2100');
  await expect(page.locator(canvas ? '#gantt canvas.fg-timeline-canvas' : '#gantt svg.fg-timeline')).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForFunction(() => '__fx' in window && '__events' in window);
  await frames(page);
}

export const frames = (page: Page): Promise<void> =>
  page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

export const scrollLeft = (page: Page): Promise<number> => page.evaluate(() => document.getElementById('gantt')!.scrollLeft);

export async function setScroll(page: Page, left: number, top = 0): Promise<void> {
  await page.evaluate(
    ([l, t]) => {
      const c = document.getElementById('gantt')!;
      c.scrollLeft = l as number;
      c.scrollTop = t as number;
    },
    [left, top] as const,
  );
  await frames(page);
}

/** Client rect of the scroll container's client area (inside its border and scrollbars). */
export async function clientBox(page: Page): Promise<{ left: number; right: number; top: number; bottom: number }> {
  return page.evaluate(() => {
    const c = document.getElementById('gantt')!;
    const r = c.getBoundingClientRect();
    const left = r.left + c.clientLeft;
    return { left, right: left + c.clientWidth, top: r.top + c.clientTop, bottom: r.top + c.clientTop + c.clientHeight };
  });
}

/** Runs `fn` in the page against the dev-only `window.__gantt`. */
export async function gantt<R, A = undefined>(page: Page, fn: (g: Record<string, (...a: never[]) => unknown>, arg: A) => R, arg?: A): Promise<Awaited<R>> {
  return page.evaluate(
    ([src, a]) => {
      const g = (window as unknown as { __gantt?: Record<string, unknown> }).__gantt;
      if (!g) throw new Error('window.__gantt not exposed by the demo');
      return (0, eval)(`(${src})`)(g, a);
    },
    [fn.toString(), arg] as const,
  ) as Promise<Awaited<R>>;
}

/** Reads one pixel of a canvas element as [r, g, b, a] (CSS px; the fixtures run at DPR 1). */
export async function canvasPixel(page: Page, selector: string, x: number, y: number): Promise<[number, number, number, number]> {
  return page.evaluate(
    ([sel, px, py]) => {
      const cv = document.querySelector<HTMLCanvasElement>(sel as string)!;
      const d = cv.getContext('2d')!.getImageData(Math.round((px as number) * (cv.width / cv.clientWidth)), Math.round((py as number) * (cv.height / cv.clientHeight)), 1, 1).data;
      return [d[0]!, d[1]!, d[2]!, d[3]!] as [number, number, number, number];
    },
    [selector, x, y] as const,
  );
}

export const isGreenish = ([r, g, b]: number[]): boolean => g! > r! + 40 && g! > b! - 10 && g! > 120;

/** Centre of the part of a bar that is inside the scroll container's client area (a long bar can be
 *  partly scrolled out of view; its geometric centre may then be off screen and unhittable). */
export async function visibleCentre(page: Page, id: string): Promise<{ x: number; y: number }> {
  const [b, c] = await Promise.all([
    page.evaluate((i) => (window as unknown as { __fx: { barBox(id: string): { x: number; y: number; w: number; h: number } } }).__fx.barBox(i), id),
    clientBox(page),
  ]);
  const left = Math.max(b.x, c.left);
  const right = Math.min(b.x + b.w, c.right);
  if (right <= left) throw new Error(`bar '${id}' is not visible`);
  return { x: (left + right) / 2, y: b.y + b.h / 2 };
}
