import { type Page, expect } from '@playwright/test';

// Shared helpers for the Canvas-drag specs (`examples/plain-html-demo/canvas-drag.html`). A Canvas
// bar has no DOM node, so geometry comes from `window.__fx.barBox(id)`, which the fixture computes
// with the renderer's own exported layout functions (viewport coordinates).

export const PX_PER_DAY = 24;
export const DAY_MS = 86_400_000;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface LogEntry {
  name: string;
  payload: Record<string, unknown>;
}

export async function openCanvasDrag(page: Page, query = ''): Promise<void> {
  await page.goto(`/canvas-drag.html${query ? `?${query}` : ''}`);
  await expect(page.locator('#gantt canvas.fg-timeline-canvas')).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => '__fx' in window && '__events' in window);
}

export async function barBox(page: Page, id: string): Promise<Box> {
  const box = await page.evaluate(
    (i) => (window as unknown as { __fx: { barBox(id: string): Box | undefined } }).__fx.barBox(i),
    id,
  );
  if (!box) throw new Error(`no bar for '${id}'`);
  return box;
}

export const centre = (b: Box): { x: number; y: number } => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

export async function events(page: Page, name: string): Promise<LogEntry[]> {
  const all = await page.evaluate(() => (window as unknown as { __events: LogEntry[] }).__events.slice());
  return all.filter((e) => e.name === name);
}

/** A task's `start`/`end` as epoch milliseconds, read through `window.__gantt`. The raw value is a
 *  date string until the first edit and a `ZonedDateTime` after it, so both go through `Date.parse`
 *  (the fixture runs in UTC); the trailing `[UTC]` annotation is not RFC 3339, hence the strip. */
export async function taskMs(page: Page, id: string, field: 'start' | 'end'): Promise<number> {
  const raw = await page.evaluate(
    ([i, f]) => {
      const g = (window as unknown as { __gantt: { getTask(id: string): Record<string, unknown> | undefined } }).__gantt;
      const t = g.getTask(i!);
      if (!t) throw new Error(`no task '${i}'`);
      return String(t[f!]);
    },
    [id, field] as const,
  );
  return Date.parse(raw.replace(/\[.*\]$/, ''));
}

export async function dependencyCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __gantt: { getDependencies(): unknown[] } }).__gantt.getDependencies().length);
}

/** Press, move in increments, release (see `tests/helpers/drag.ts` for why the steps matter). */
export async function mouseDragTo(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  { steps = 10, release = true }: { steps?: number; release?: boolean } = {},
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
  }
  if (release) await page.mouse.up();
}

export const canvasCursor = (page: Page): Promise<string> =>
  page.evaluate(() => document.querySelector<HTMLCanvasElement>('canvas.fg-timeline-canvas')!.style.cursor);
