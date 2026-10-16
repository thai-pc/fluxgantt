import { expect, test } from '@playwright/test';
import { expectHeaderLabelsDisjoint } from '../helpers/header-labels';

// Header labels must never overlap, in any view mode and in a non-English locale
// (spec-header-label-overlap.md). `collapse.html` composes withViewport (`zoomTo`);
// `i18n.html` renders with locale 'vi'.

for (const mode of ['day', 'week', 'month', 'quarter', 'year']) {
  test(`header labels do not intersect in ${mode} view`, async ({ page }) => {
    await page.goto('/collapse.html');
    await page.evaluate((m) => {
      (window as unknown as { __gantt: { zoomTo(m: string): void } }).__gantt.zoomTo(m);
    }, mode);
    await expectHeaderLabelsDisjoint(page, '#gantt svg');
  });
}

test('header labels do not intersect with the vi locale', async ({ page }) => {
  await page.goto('/i18n.html');
  await expectHeaderLabelsDisjoint(page, '#gantt svg');
});

// Canvas paint-order regression: the header is painted before the rows and is pinned, so a
// vertical scroll must never let a bar or row-label text paint into the header band. The
// band's pixels must therefore be identical at scrollTop 0 and scrollTop 800.
test('canvas header band is untouched by rows after a vertical scroll', async ({ page }) => {
  await page.goto('/collapse.html?pad=2100');
  // The Canvas renderer is a lazy chunk: wait for it before zooming and scrolling.
  await page.locator('#gantt canvas').waitFor();
  await page.evaluate(() => {
    (window as unknown as { __gantt: { zoomTo(m: string): void } }).__gantt.zoomTo('month');
  });
  const readBand = (): Promise<string> =>
    page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('#gantt canvas')!;
      const dpr = canvas.width / canvas.clientWidth;
      const band = canvas
        .getContext('2d')!
        .getImageData(0, 0, canvas.width, Math.floor(32 * dpr) - 1);
      let hash = 5381;
      for (let i = 0; i < band.data.length; i++) hash = ((hash * 33) ^ band.data[i]!) >>> 0;
      return `${band.width}x${band.height}:${hash}`;
    });
  const scrollTo = async (top: number): Promise<void> => {
    await page.evaluate(async (t) => {
      document.querySelector<HTMLElement>('#gantt')!.scrollTop = t;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }, top);
  };
  await scrollTo(0);
  const before = await readBand();
  await scrollTo(800);
  await expect
    .poll(() => page.evaluate(() => document.querySelector<HTMLElement>('#gantt')!.scrollTop))
    .toBe(800);
  expect(await readBand()).toBe(before);
});
