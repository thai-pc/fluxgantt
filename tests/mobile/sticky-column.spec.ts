import { test, expect, type Page } from '@playwright/test';

// Pinned SVG label column on a coarse pointer (spec-svg-sticky-label-column.md section 6/11.2.9).
// `withResponsive` narrows the column, so the overlays must follow its width; the JS pan owns a
// finger that starts on a clone; a tap on a pinned label selects. Fixture: `responsive.html`.

const COLUMN = '#gantt svg.fg-timeline__sticky-column';

async function touch(page: Page, type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number) {
  await page.evaluate(
    ([t, px, py]) => {
      const target = document.elementFromPoint(px as number, py as number);
      if (!target) throw new Error('no element at the touch point');
      target.dispatchEvent(
        new PointerEvent(t as string, {
          pointerId: 1,
          pointerType: 'touch',
          isPrimary: true,
          bubbles: true,
          cancelable: true,
          composed: true,
          button: 0,
          buttons: t === 'pointerup' ? 0 : 1,
          clientX: px as number,
          clientY: py as number,
        }),
      );
    },
    [type, x, y] as const,
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto('/responsive.html');
  await expect(page.locator('#gantt svg.fg-timeline')).toBeVisible();
  await expect(page.locator(COLUMN)).toHaveCount(1);
});

test('the pinned column and corner take the narrowed responsive label width, and stay at the edge', async ({ page }) => {
  const m = await page.evaluate(async () => {
    const c = document.getElementById('gantt')!;
    c.scrollLeft = 300;
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const labelW = (window as never as { __gantt: { getLabelColumnWidth?: () => number } }).__gantt.getLabelColumnWidth?.();
    const col = c.querySelector('svg.fg-timeline__sticky-column')!;
    const corner = c.querySelector('.fg-timeline__sticky-corner')!;
    return {
      labelW,
      colW: Number(col.getAttribute('width')),
      cornerW: Number(corner.getAttribute('width')),
      colLeft: col.getBoundingClientRect().left,
      containerLeft: c.getBoundingClientRect().left + c.clientLeft,
    };
  });
  expect(m.colW).toBeLessThan(160); // narrowed from the desktop default on a 393px viewport
  expect(m.cornerW).toBe(m.colW);
  expect(Math.abs(m.colLeft - m.containerLeft)).toBeLessThanOrEqual(0.5);
});

test('a touch drag that starts on the pinned column pans the container', async ({ page }) => {
  // All events go to the element the pointerdown hit, like implicit touch capture does.
  const left = await page.evaluate(async () => {
    const c = document.getElementById('gantt')!;
    c.scrollIntoView();
    const col = c.querySelector('svg.fg-timeline__sticky-column')!;
    const r = col.getBoundingClientRect();
    const x = r.left + 40;
    const y = r.top + 60;
    const ev = (t: string, cx: number) =>
      new PointerEvent(t, { pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, composed: true, button: 0, buttons: t === 'pointerup' ? 0 : 1, clientX: cx, clientY: y });
    col.dispatchEvent(ev('pointerdown', x));
    for (const dx of [-10, -30, -60]) col.dispatchEvent(ev('pointermove', x + dx));
    col.dispatchEvent(ev('pointerup', x - 60));
    return c.scrollLeft;
  });
  expect(left).toBeGreaterThan(0);
});

test('a tap on a pinned label selects its row', async ({ page }) => {
  const label = page.locator(`${COLUMN} .fg-timeline__row-label[data-task-id="build"]`);
  const b = (await label.boundingBox())!;
  const x = b.x + 4;
  const y = b.y + b.height / 2;
  await touch(page, 'pointerdown', x, y);
  await touch(page, 'pointerup', x, y);
  await expect(page.locator('.fg-timeline__row[data-task-id="build"]')).toHaveAttribute('aria-selected', 'true');
});

test('scrollToTask start lands the bar right of the pinned column, not under it', async ({ page }) => {
  const m = await page.evaluate(async () => {
    const g = (window as never as { __gantt: { scrollToTask(id: string, o: object): void } }).__gantt;
    g.scrollToTask('launch', { align: 'start' });
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const c = document.getElementById('gantt')!;
    const bar = c.querySelector('.fg-task[data-task-id="launch"] .fg-task__bar')!.getBoundingClientRect();
    const col = c.querySelector('svg.fg-timeline__sticky-column')!.getBoundingClientRect();
    return { barLeft: bar.left, colRight: col.right };
  });
  // A milestone is a diamond padded by its half-diagonal, so it may sit a little left of the edge.
  expect(m.barLeft).toBeGreaterThanOrEqual(m.colRight - 14);
});
