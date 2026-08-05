import { test, expect } from '@playwright/test';

// TODO (deferred, not faked): drag-move e2e. The host app + `window.__gantt` handle are now in
// place (playwright.config.ts webServer → examples/plain-html-demo). What remains is the
// pointer-geometry: a real drag must move the bar by at least one snapped time-grid unit
// (day/week per viewMode) for the drag-move recognizer to commit, and the exact pixel delta
// depends on the SVG renderer's TimeScale layout math. Implement by:
//   1. `page.goto('/')` and register a capture: `await page.evaluate(() => { (window as any).__moved = [];
//      (window as any).__gantt.on('task:moved', (t) => (window as any).__moved.push(t.id)); })`.
//   2. Locate the target bar via `page.locator('[data-task-id="build"] .fg-task__bar')`,
//      read its bounding box, and `page.mouse` drag it right by ≥ one grid column width
//      (derive the column width from two adjacent `.fg-timeline__grid-line` x positions).
//   3. Assert `window.__moved` contains 'build' and that the task's `start` advanced
//      (`__gantt.getTask(toTaskId('build')).start`).
test.fixme('dragging a task bar horizontally emits task:moved', async ({ page }) => {
  await page.goto('/');
  expect(true).toBe(true);
});
