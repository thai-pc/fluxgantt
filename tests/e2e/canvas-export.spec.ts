import { readFile } from 'node:fs/promises';
import { test, expect, type Download, type Page } from '@playwright/test';

// Canvas-mode (>= 2000 tasks) exportSvg()/exportPng() through the REAL facade
// (spec-canvas-export.md). Fixture: `examples/plain-html-demo/canvas-export-harness.html`
// (`withInteraction(withIo(withRender(createGantt())))` + `withViewport`, 2100 flat tasks by
// default). The harness' "Export SVG" / "Export PNG" buttons download via object URL + `<a
// download>`; failures are mirrored on `#export-status[data-state=error][data-error]`.
//
// Geometry used below (default density): row = 32 px, header = 32 px, so 2100 rows is
// 67,232 css px tall -> scale 1 exceeds the 65,535 px per-side cap by design; scale 0.5 fits.
// compact density (24 px rows) is 50,432 px and fits at scale 1.

const ROWS = 2100;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function openHarness(page: Page, query = ''): Promise<void> {
  await page.goto(`/canvas-export-harness.html${query}`);
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);
}

async function clickAndDownload(page: Page, button: 'Export SVG' | 'Export PNG'): Promise<Download> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: button }).click(),
  ]);
  return download;
}

async function downloadBytes(download: Download): Promise<Buffer> {
  const path = await download.path();
  return readFile(path);
}

function pngSize(bytes: Buffer): { width: number; height: number } {
  expect([...bytes.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
  expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const status = (page: Page) => page.locator('#export-status');

async function expectExportError(page: Page, pattern: RegExp): Promise<void> {
  await expect(status(page)).toHaveAttribute('data-state', 'error');
  expect(await status(page).getAttribute('data-error')).toMatch(pattern);
}

/** Decodes a PNG in the page and reports opaque / transparent pixel counts of the top-left crop. */
async function samplePng(page: Page, bytes: Buffer) {
  return page.evaluate(async (b64) => {
    const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([raw], { type: 'image/png' }));
    const w = Math.min(bmp.width, 600);
    const h = Math.min(bmp.height, 400);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0, w, h, 0, 0, w, h);
    // The far corner of the full image (bottom-right) is plain grid/background.
    const corner = document.createElement('canvas');
    corner.width = 4;
    corner.height = 4;
    const cctx = corner.getContext('2d')!;
    cctx.drawImage(bmp, bmp.width - 4, bmp.height - 4, 4, 4, 0, 0, 4, 4);
    const data = ctx.getImageData(0, 0, w, h).data;
    let nonWhiteOpaque = 0;
    let transparent = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) transparent++;
      else if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) nonWhiteOpaque++;
    }
    const cd = cctx.getImageData(0, 0, 4, 4).data;
    return { nonWhiteOpaque, transparent, cornerRgba: [cd[0]!, cd[1]!, cd[2]!, cd[3]!] };
  }, bytes.toString('base64'));
}

async function parseSvg(page: Page, text: string) {
  return page.evaluate((src) => {
    const doc = new DOMParser().parseFromString(src, 'image/svg+xml');
    const err = doc.querySelector('parsererror');
    const all = Array.from(doc.querySelectorAll('*'));
    return {
      wellFormed: err === null,
      root: doc.documentElement.localName,
      rowCount: doc.querySelectorAll('[role="row"]').length,
      scripts: doc.querySelectorAll('script').length,
      foreign: doc.querySelectorAll('foreignObject').length,
      onAttrs: all.flatMap((el) =>
        Array.from(el.attributes)
          .filter((a) => /^on/i.test(a.name))
          .map((a) => a.name),
      ),
      jsUrls: all.flatMap((el) =>
        Array.from(el.attributes)
          .filter((a) => /javascript:/i.test(a.value))
          .map((a) => a.name),
      ),
      title: doc.querySelector('svg > title')?.textContent ?? null,
      texts: Array.from(doc.querySelectorAll('text')).map((t) => t.textContent ?? ''),
      imgInjected: doc.querySelectorAll('img').length,
    };
  }, text);
}

test.describe('harness', () => {
  test('mounts in Canvas mode', async ({ page }) => {
    await openHarness(page);
    await expect(page.locator('canvas.fg-timeline-canvas')).toBeVisible();
    await expect(page.locator('svg.fg-timeline')).toHaveCount(0);
  });
});

test.describe('exportSvg in Canvas mode', () => {
  test('downloads a well-formed SVG with one role=row per visible task', async ({ page }) => {
    await openHarness(page);
    const download = await clickAndDownload(page, 'Export SVG');
    expect(download.suggestedFilename()).toBe('gantt.svg');
    await expect(status(page)).toHaveAttribute('data-state', 'ok');
    const text = (await downloadBytes(download)).toString('utf8');
    const svg = await parseSvg(page, text);
    expect(svg.wellFormed).toBe(true);
    expect(svg.root).toBe('svg');
    expect(svg.rowCount).toBe(ROWS);
    expect(svg.texts).toContain('Row 0');
    expect(svg.texts).toContain(`Row ${ROWS - 1}`);
  });

  test('<title> carries the chart aria-label', async ({ page }) => {
    await openHarness(page);
    const label = await page.locator('#gantt [role="grid"]').first().getAttribute('aria-label');
    expect(label).toBeTruthy();
    const text = (await downloadBytes(await clickAndDownload(page, 'Export SVG'))).toString('utf8');
    const svg = await parseSvg(page, text);
    expect(svg.title).toBe(label);
  });

  test('hostile task name and color cannot inject script, handlers or javascript: URLs', async ({ page }) => {
    await openHarness(page, '?hostile=1');
    const text = (await downloadBytes(await clickAndDownload(page, 'Export SVG'))).toString('utf8');
    const svg = await parseSvg(page, text);
    expect(svg.wellFormed).toBe(true);
    expect(svg.scripts).toBe(0);
    expect(svg.foreign).toBe(0);
    expect(svg.onAttrs).toEqual([]);
    expect(svg.jsUrls).toEqual([]);
    expect(svg.imgInjected).toBe(0);
    expect(text).not.toMatch(/<script/i);
    expect(text).not.toMatch(/javascript:/i);
    // The hostile name survives only as escaped text.
    expect(svg.texts.some((t) => t.includes('<img src=x onerror=alert(1)>'))).toBe(true);
  });

  test('a --fg-* override on the container is baked into the export', async ({ page }) => {
    await openHarness(page);
    await page.locator('#gantt').evaluate((el) => el.style.setProperty('--fg-task-default', '#00ff00'));
    const text = (await downloadBytes(await clickAndDownload(page, 'Export SVG'))).toString('utf8');
    expect(text.toLowerCase()).toMatch(/#00ff00|rgb\(0,\s*255,\s*0\)/);
    expect(text).not.toMatch(/var\(--fg-task-default/);
  });

  test('mid-scroll export still contains the first and the last row', async ({ page }) => {
    await openHarness(page);
    await page.locator('#gantt').evaluate((el) => {
      el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) / 2);
    });
    const text = (await downloadBytes(await clickAndDownload(page, 'Export SVG'))).toString('utf8');
    const svg = await parseSvg(page, text);
    expect(svg.texts).toContain('Row 0');
    expect(svg.texts).toContain(`Row ${ROWS - 1}`);
    expect(svg.rowCount).toBe(ROWS);
  });

  test('does not move focus or scroll, and leaves no hidden host behind', async ({ page }) => {
    await openHarness(page);
    const container = page.locator('#gantt');
    await container.evaluate((el) => {
      el.scrollTop = 4000;
      el.scrollLeft = 0;
    });
    await page.getByRole('button', { name: 'Export SVG' }).focus();
    const childrenBefore = await container.evaluate((el) => el.querySelectorAll('*').length);
    const before = await page.evaluate(() => ({
      active: document.activeElement?.id,
      top: document.querySelector('#gantt')!.scrollTop,
    }));
    await clickAndDownload(page, 'Export SVG');
    await expect(status(page)).toHaveAttribute('data-state', 'ok');
    const after = await page.evaluate(() => ({
      active: document.activeElement?.id,
      top: document.querySelector('#gantt')!.scrollTop,
    }));
    expect(after).toEqual(before);
    expect(await container.evaluate((el) => el.querySelectorAll('*').length)).toBe(childrenBefore);
    await expect(container.locator('svg')).toHaveCount(0);
  });
});

test.describe('exportPng in Canvas mode', () => {
  test('scale 0.5 yields a PNG of exactly the scaled chart size, non-blank, white background', async ({
    page,
  }) => {
    await openHarness(page, '?scale=0.5');
    const download = await clickAndDownload(page, 'Export PNG');
    expect(download.suggestedFilename()).toBe('gantt.png');
    await expect(status(page)).toHaveAttribute('data-state', 'ok');
    const bytes = await downloadBytes(download);
    const { width, height } = pngSize(bytes);
    // Height: header 32 + 2100 rows x 32 px = 67,232 css px, halved.
    expect(height).toBe(33_616);
    expect(width).toBeGreaterThan(160 / 2);
    const px = await samplePng(page, bytes);
    expect(px.nonWhiteOpaque).toBeGreaterThan(200);
    expect(px.transparent).toBe(0);
  });

  test('scale 1 and half scale agree on the aspect (compact density fits at scale 1)', async ({ page }) => {
    await openHarness(page, '?density=compact&scale=1');
    const full = pngSize(await downloadBytes(await clickAndDownload(page, 'Export PNG')));
    expect(full.height).toBe(32 + ROWS * 24);
    await openHarness(page, '?density=compact&scale=0.5');
    const half = pngSize(await downloadBytes(await clickAndDownload(page, 'Export PNG')));
    expect(half.height).toBe(Math.round((32 + ROWS * 24) / 2));
    expect(half.width).toBe(Math.round(full.width / 2));
  });

  test('default-density scale 1 (67,232 px tall) rejects with the documented size error', async ({ page }) => {
    await openHarness(page, '?scale=1');
    await page.getByRole('button', { name: 'Export PNG' }).click();
    await expectExportError(page, /gantt\.exportPng: output \d+x67232px exceeds this browser's safe canvas limit/);
    expect(await status(page).getAttribute('data-error')).toMatch(/use exportSvg\(\)/);
  });

  test('transparent background keeps alpha 0 where nothing is painted', async ({ page }) => {
    await openHarness(page, '?density=compact&scale=0.25');
    await page.evaluate(() => {
      // Re-bind the PNG button to a transparent export (the harness button uses the default).
      const g = (window as unknown as { __gantt: { exportPng(o: object): Promise<Blob> } }).__gantt;
      const btn = document.getElementById('export-png')!;
      const clone = btn.cloneNode(true) as HTMLElement;
      btn.replaceWith(clone);
      clone.addEventListener('click', () => {
        void g.exportPng({ scale: 0.25, background: 'transparent' }).then((blob) => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'gantt.png';
          document.body.appendChild(a);
          a.click();
          a.remove();
        });
      });
    });
    const bytes = await downloadBytes(await clickAndDownload(page, 'Export PNG'));
    const px = await samplePng(page, bytes);
    expect(px.transparent).toBeGreaterThan(0);
    expect(px.nonWhiteOpaque + px.transparent).toBeGreaterThan(0);

    await openHarness(page, '?density=compact&scale=0.25');
    const white = await samplePng(page, await downloadBytes(await clickAndDownload(page, 'Export PNG')));
    expect(white.transparent).toBe(0);
    expect(white.cornerRgba[3]).toBe(255);
  });

  test('does not move focus or scroll', async ({ page }) => {
    await openHarness(page, '?scale=0.5');
    await page.locator('#gantt').evaluate((el) => (el.scrollTop = 4000));
    await page.getByRole('button', { name: 'Export PNG' }).focus();
    const before = await page.evaluate(() => ({
      active: document.activeElement?.id,
      top: document.querySelector('#gantt')!.scrollTop,
    }));
    await clickAndDownload(page, 'Export PNG');
    await expect(status(page)).toHaveAttribute('data-state', 'ok');
    const after = await page.evaluate(() => ({
      active: document.activeElement?.id,
      top: document.querySelector('#gantt')!.scrollTop,
    }));
    expect(after).toEqual(before);
  });
});

test.describe('visible-row cap (5,000)', () => {
  const CAP_MESSAGE = /5000|5,000/;

  test('both formats reject above the cap and the chart stays interactive', async ({ page }) => {
    await openHarness(page, '?tasks=5100&scale=0.1');
    await page.getByRole('button', { name: 'Export SVG' }).click();
    await expectExportError(page, /gantt\.exportSvg: 5100 visible rows exceeds the Canvas-mode export limit/);
    expect(await status(page).getAttribute('data-error')).toMatch(CAP_MESSAGE);

    await page.evaluate(() => document.getElementById('export-status')!.removeAttribute('data-state'));
    await page.getByRole('button', { name: 'Export PNG' }).click();
    await expectExportError(page, /gantt\.exportPng: 5100 visible rows exceeds the Canvas-mode export limit/);
    expect(await status(page).getAttribute('data-error')).toMatch(CAP_MESSAGE);

    // Still interactive: scrolling repaints and keyboard focus works.
    await page.locator('#gantt').evaluate((el) => (el.scrollTop = 3000));
    expect(await page.locator('#gantt').evaluate((el) => el.scrollTop)).toBe(3000);
    await expect(page.locator('canvas.fg-timeline-canvas')).toBeVisible();
    const hasGrid = await page.evaluate(() => document.querySelectorAll('[role="row"]').length > 0);
    expect(hasGrid).toBe(true);
  });

  test('collapsing below the cap makes both formats succeed', async ({ page }) => {
    await openHarness(page, '?tasks=5100&group=1&scale=0.5');
    await page.getByRole('button', { name: 'Export SVG' }).click();
    await expectExportError(page, /visible rows exceeds/);

    await page.evaluate(() =>
      (window as unknown as { __gantt: { toggleCollapse(id: string): void } }).__gantt.toggleCollapse('task-0'),
    );
    const svgDownload = await clickAndDownload(page, 'Export SVG');
    await expect(status(page)).toHaveAttribute('data-state', 'ok');
    const svg = await parseSvg(page, (await downloadBytes(svgDownload)).toString('utf8'));
    expect(svg.rowCount).toBe(1);

    const png = pngSize(await downloadBytes(await clickAndDownload(page, 'Export PNG')));
    expect(png.height).toBe(Math.round((32 + 32) / 2));
  });
});
