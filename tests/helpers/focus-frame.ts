import type { Page } from '@playwright/test';

// Shared helpers for the row focus frame specs (spec-focus-visible-offscreen.md). Fixture:
// `collapse.html?pad=N` (N < 2000 = SVG, N >= 2000 = Canvas), a 420 px-wide `#gantt` scroller.

export const HEADER = 32;
export const ROW = 32;
export const LABEL_W = 160;
/** `--fg-task-focus` light default, #0369a1. */
export const ACCENT: readonly [number, number, number] = [3, 105, 161];

export async function openFocusFixture(page: Page, pad: number): Promise<void> {
  await page.goto(`/collapse.html?pad=${pad}`);
  await page.evaluate(() => {
    document.getElementById('gantt')!.style.width = '420px';
  });
  await page.locator('#gantt [tabindex="0"]').first().focus();
}

/** Scrolls the chart to its far right end (August bars off screen to the left). */
export async function scrollFar(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const c = document.getElementById('gantt')!;
    c.scrollLeft = c.scrollWidth;
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
}

export const containerBox = (page: Page) =>
  page.evaluate(() => {
    const c = document.getElementById('gantt')!;
    const r = c.getBoundingClientRect();
    return { left: r.left + c.clientLeft, top: r.top + c.clientTop, width: c.clientWidth, height: c.clientHeight, scrollTop: c.scrollTop };
  });

/**
 * Fraction (0..1) of pixels in a CSS-px viewport clip that are within `tol` per channel of `rgb`.
 * Reads the COMPOSITED page (a screenshot decoded in the page), never a canvas bitmap.
 */
export async function accentShare(
  page: Page,
  clip: { x: number; y: number; width: number; height: number },
  rgb: readonly [number, number, number] = ACCENT,
  tol = 24,
): Promise<number> {
  const png = await page.screenshot({ clip });
  const b64 = png.toString('base64');
  return page.evaluate(
    async ([data, target, t]) => {
      const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
      const cv = new OffscreenCanvas(img.width, img.height);
      const ctx = cv.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, img.width, img.height).data;
      let hit = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (Math.abs(d[i]! - target![0]!) <= t! && Math.abs(d[i + 1]! - target![1]!) <= t! && Math.abs(d[i + 2]! - target![2]!) <= t!) hit++;
      }
      return hit / (d.length / 4);
    },
    [b64, rgb as number[], tol] as const,
  );
}
