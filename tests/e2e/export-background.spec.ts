import { test, expect, type Page } from '@playwright/test';

// Export ground (spec-export-background.md), proven on real decoded pixels, which jsdom cannot.
// SVG mode: the demo (`/`) themes via `withTheme` + its own `--fg-bg` (light `#fafafa`, dark
// `#0a0a0a`). Canvas mode: the harness has no theme, so the ground is driven by `--fg-bg` on the
// mount container, which is exactly the signal `withTheme` writes.

type ExportHandle = {
  exportPng(o?: object): Promise<Blob>;
  exportSvg(o?: object): string;
};

async function cycleToTheme(page: Page, theme: string): Promise<void> {
  const button = page.locator('#theme-toggle');
  for (let i = 0; i < 3; i += 1) {
    if ((await button.textContent())?.trim() === `Theme: ${theme}`) return;
    await button.click();
  }
  throw new Error(`theme toggle never reached "${theme}"`);
}

/** Exports in the page, decodes the result and reports the bottom-right pixel (plain
 *  background/grid area) plus how many pixels are fully transparent. `svg` loads the SVG string
 *  through an <img> onto a transparent canvas, i.e. how a viewer would paint the file. */
async function sampleExport(
  page: Page,
  kind: 'png' | 'svg',
  options: object,
  scale = 1,
): Promise<{ rgba: number[]; transparent: number }> {
  return page.evaluate(
    async ({ kind, options, scale }) => {
      const g = (window as unknown as { __gantt?: ExportHandle }).__gantt;
      if (!g) throw new Error('window.__gantt not exposed');
      let src: ImageBitmap | HTMLImageElement;
      if (kind === 'png') {
        src = await createImageBitmap(await g.exportPng({ scale, ...options }));
      } else {
        const url = URL.createObjectURL(new Blob([g.exportSvg(options)], { type: 'image/svg+xml' }));
        const img = new Image();
        await new Promise<void>((res, rej) => {
          img.onload = () => res();
          img.onerror = () => rej(new Error('svg decode failed'));
          img.src = url;
        });
        src = img;
      }
      const w = 'naturalWidth' in src ? src.naturalWidth : src.width;
      const h = 'naturalHeight' in src ? src.naturalHeight : src.height;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(src, 0, 0, w, h);
      const px = ctx.getImageData(w - 2, h - 2, 1, 1).data;
      const all = ctx.getImageData(0, 0, w, h).data;
      let transparent = 0;
      for (let i = 3; i < all.length; i += 4) if (all[i] === 0) transparent++;
      return { rgba: [px[0]!, px[1]!, px[2]!, px[3]!], transparent };
    },
    { kind, options, scale },
  );
}

for (const kind of ['png', 'svg'] as const) {
  test.describe(`SVG-mode ${kind} export ground`, () => {
    test('a dark chart exports on the dark ground, not white or transparent', async ({ page }) => {
      await page.goto('/');
      await cycleToTheme(page, 'dark');
      const { rgba } = await sampleExport(page, kind, {});
      expect(rgba[3]).toBe(255);
      for (const ch of rgba.slice(0, 3)) expect(ch).toBeLessThan(40);
    });

    test('a light chart exports on the light ground', async ({ page }) => {
      await page.goto('/');
      await cycleToTheme(page, 'light');
      const { rgba } = await sampleExport(page, kind, {});
      expect(rgba[3]).toBe(255);
      for (const ch of rgba.slice(0, 3)) expect(ch).toBeGreaterThanOrEqual(240);
    });

    test('an explicit background wins over the theme', async ({ page }) => {
      await page.goto('/');
      await cycleToTheme(page, 'dark');
      const { rgba } = await sampleExport(page, kind, { background: '#ff0000' });
      expect(rgba).toEqual([255, 0, 0, 255]);
    });

    test("background 'transparent' leaves transparent pixels", async ({ page }) => {
      await page.goto('/');
      await cycleToTheme(page, 'dark');
      const { transparent } = await sampleExport(page, kind, { background: 'transparent' });
      expect(transparent).toBeGreaterThan(0);
    });
  });
}

test('exported SVG string has the ground rect right after <title>', async ({ page }) => {
  await page.goto('/');
  await cycleToTheme(page, 'dark');
  const kids = await page.evaluate(() => {
    const g = (window as unknown as { __gantt: ExportHandle }).__gantt;
    const doc = new DOMParser().parseFromString(g.exportSvg(), 'image/svg+xml');
    const c = Array.from(doc.documentElement.children);
    return [c[0]!.localName, c[1]!.localName, c[1]!.getAttribute('fill')];
  });
  expect(kids).toEqual(['title', 'rect', '#0a0a0a']);
});

test.describe('Canvas-mode export ground', () => {
  async function openHarness(page: Page, bg: string | null): Promise<void> {
    await page.goto('/canvas-export-harness.html?density=compact');
    await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);
    if (bg) await page.evaluate((v) => document.getElementById('gantt')!.style.setProperty('--fg-bg', v), bg);
  }

  test('dark --fg-bg exports a dark corner', async ({ page }) => {
    await openHarness(page, '#0a0a0a');
    const { rgba } = await sampleExport(page, 'png', {}, 0.25);
    expect(rgba[3]).toBe(255);
    for (const ch of rgba.slice(0, 3)) expect(ch).toBeLessThan(40);
  });

  test("the page's own light --fg-bg (#fafafa, inherited into the container) is the default ground", async ({
    page,
  }) => {
    await openHarness(page, null);
    expect((await sampleExport(page, 'png', {}, 0.25)).rgba).toEqual([250, 250, 250, 255]);
  });

  test('explicit background wins; transparent leaves alpha 0 pixels', async ({ page }) => {
    await openHarness(page, '#0a0a0a');
    expect((await sampleExport(page, 'png', { background: '#00ff00' }, 0.25)).rgba).toEqual([0, 255, 0, 255]);
    expect((await sampleExport(page, 'png', { background: 'transparent' }, 0.25)).transparent).toBeGreaterThan(0);
  });

  test('exportSvg() in Canvas mode carries the ground rect', async ({ page }) => {
    await openHarness(page, '#0a0a0a');
    const rect = await page.evaluate(() => {
      const g = (window as unknown as { __gantt: ExportHandle }).__gantt;
      const doc = new DOMParser().parseFromString(g.exportSvg({ inlineComputedStyle: false }), 'image/svg+xml');
      const r = Array.from(doc.documentElement.children).find((c) => c.localName === 'rect')!;
      return [r.getAttribute('fill'), r.getAttribute('width')];
    });
    expect(rect).toEqual(['#0a0a0a', '100%']);
  });
});
