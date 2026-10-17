import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Accessibility of the pinned label column (spec-svg-sticky-label-column.md section 11.3): the
// clones are presentation only, so a scrolled chart must stay violation-free, every task name must
// be exposed exactly once, and nothing in the overlays may be focusable or animated.

async function scrollBoth(page: Page) {
  await page.evaluate(async () => {
    const c = document.getElementById('gantt')!;
    c.style.width = '420px';
    c.scrollTop = 200;
    c.scrollLeft = 400;
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
}

test.describe('SVG renderer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/collapse.html?pad=60');
    await expect(page.locator('svg.fg-timeline')).toBeVisible();
    await scrollBoth(page);
  });

  test('no axe violations while scrolled on both axes', async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .include('#gantt')
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test('each task name is exposed once: clones and corner are aria-hidden, the real labels stay as gridcell text', async ({
    page,
  }) => {
    const m = await page.evaluate(() => {
      const c = document.getElementById('gantt')!;
      const overlays = [...c.querySelectorAll('.fg-timeline__sticky-column, .fg-timeline__sticky-header, .fg-timeline__sticky-corner')];
      return {
        allHidden: overlays.length === 3 && overlays.every((o) => o.getAttribute('aria-hidden') === 'true'),
        focusable: c.querySelectorAll('.fg-timeline__layer :is(.fg-timeline__sticky-column, .fg-timeline__sticky-header, .fg-timeline__sticky-corner) [tabindex]').length,
        cellName: c.querySelector('[role="gridcell"]')!.textContent,
        ids: [...c.querySelectorAll('[id]')].filter((e) => e.closest('[aria-hidden="true"]')).length,
      };
    });
    expect(m.allHidden).toBe(true);
    expect(m.focusable).toBe(0);
    expect(m.cellName).toContain('Phase 1');
    expect(m.ids).toBe(0);
    const snapshot = await page.locator('#gantt').ariaSnapshot();
    // The overlays add nothing to the accessibility tree: removing them leaves the snapshot identical.
    await page.evaluate(() => document.querySelectorAll('.fg-timeline__sticky-column, .fg-timeline__sticky-header, .fg-timeline__sticky-corner').forEach((e) => e.remove()));
    expect(await page.locator('#gantt').ariaSnapshot()).toBe(snapshot);
  });

  test('the overlays carry no transition or animation, also under prefers-reduced-motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const m = await page.evaluate(() =>
      [...document.querySelectorAll('.fg-timeline__sticky-column, .fg-timeline__sticky-header, .fg-timeline__sticky-corner')].map((e) => {
        const s = getComputedStyle(e);
        return { t: s.transitionDuration, a: s.animationName };
      }),
    );
    for (const x of m) expect(x).toEqual({ t: '0s', a: 'none' });
  });

  test('the real labels are invisible but the clone has the same text colour token', async ({ page }) => {
    const m = await page.evaluate(() => {
      const real = document.querySelector('svg.fg-timeline .fg-timeline__row-label')!;
      const clone = document.querySelector('.fg-timeline__sticky-column .fg-timeline__row-label')!;
      return { opacity: getComputedStyle(real).opacity, cloneOpacity: getComputedStyle(clone).opacity, a: getComputedStyle(real).fill, b: getComputedStyle(clone).fill };
    });
    expect(m.opacity).toBe('0');
    expect(m.cloneOpacity).toBe('1');
    expect(m.a).toBe(m.b);
  });
});
