import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PX_PER_DAY, barBox, centre, mouseDragTo, openCanvasDrag } from '../helpers/canvas-drag.js';

// Accessibility during and after a Canvas drag (spec-canvas-drag.md §9/§11, WCAG 2.1 AA). The
// overlay canvas is `aria-hidden`, so a drag in flight must leave the page axe-clean and the hidden
// ARIA grid (the real accessibility tree of a Canvas chart) intact; after a committed drag the
// grid's per-task `aria-label` carries the new dates, which is the post-commit announcement path.

const GRID = '.fg-timeline-a11y-layer';

test('axe is clean mid-drag, with the overlay aria-hidden and the grid + roving tabindex intact', async ({ page }) => {
  await openCanvasDrag(page);
  const c = centre(await barBox(page, 'a'));
  await mouseDragTo(page, c, { x: c.x + 3 * PX_PER_DAY, y: c.y }, { release: false });
  const overlay = page.locator('canvas.fg-timeline-canvas-overlay');
  await expect(overlay).toHaveCount(1);
  await expect(overlay).toHaveAttribute('aria-hidden', 'true');

  const results = await new AxeBuilder({ page }).include('#gantt').analyze();
  expect(results.violations).toEqual([]);

  await expect(page.locator(GRID)).toHaveAttribute('role', /grid|treegrid/);
  await expect(page.locator(`${GRID} [role="row"][tabindex="0"]`)).toHaveCount(1);
  await page.mouse.up();
});

test('after a committed drag the task\'s aria-label reports the new dates', async ({ page }) => {
  await openCanvasDrag(page);
  const label = () => page.locator(`${GRID} .fg-timeline-canvas__task[data-task-id="a"]`).getAttribute('aria-label');
  const before = await label();
  const c = centre(await barBox(page, 'a'));
  await mouseDragTo(page, c, { x: c.x + 3 * PX_PER_DAY, y: c.y });
  await expect.poll(label).not.toBe(before);
  const results = await new AxeBuilder({ page }).include('#gantt').analyze();
  expect(results.violations).toEqual([]);
});
