import { test, expect } from '@playwright/test';

// TODO (deferred, not faked): drag-create-dependency e2e. Substrate ready (webServer +
// window.__gantt). Remaining work: hover a source task to reveal its `.fg-task__link-handle`
// (hover-revealed via CSS — force it with `page.hover('[data-task-id="review"]')`), then
// `page.mouse` drag from that handle onto another task bar and release. Assert `dependency:added`
// fired (capture via `__gantt.on('dependency:added', …)`) and `__gantt.getDependencies()` grew
// by one. The link-handle center coordinates come from the renderer's per-bar geometry, so this
// is deferred rather than hard-coded here.
test.fixme('dragging between two link handles emits dependency:added', async ({ page }) => {
  await page.goto('/');
  expect(true).toBe(true);
});
