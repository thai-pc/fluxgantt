import { test } from '@playwright/test';
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
