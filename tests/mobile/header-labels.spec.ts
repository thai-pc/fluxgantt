import { test } from '@playwright/test';
import { expectHeaderLabelsDisjoint } from '../helpers/header-labels';

test('header labels do not intersect on a phone viewport', async ({ page }) => {
  await page.goto('/responsive.html');
  await expectHeaderLabelsDisjoint(page, '#gantt svg.fg-timeline');
});
