import { test, expect } from '@playwright/test';

// TODO (deferred, not faked): drag-resize e2e. Substrate ready (webServer + window.__gantt).
// Remaining work is pointer geometry: grab a bar's edge-resize handle (the edge zone of
// `[data-task-id="build"] .fg-task__bar`) and drag it outward by ≥ one snapped grid unit, then
// assert `task:resized` fired (capture via `__gantt.on('task:resized', …)` like drag-move) and
// that the task's `duration`/`end` grew. The edge hit-zone width and grid-column width both
// come from the renderer's layout math, which this stub intentionally does not hard-code.
test.fixme('dragging a task edge emits task:resized', async ({ page }) => {
  await page.goto('/');
  expect(true).toBe(true);
});
