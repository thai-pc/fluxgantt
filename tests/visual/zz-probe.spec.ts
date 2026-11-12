// TEMPORARY CI probe (PR #139, M2): which change makes the dark pinned-band label text lose LCD
// antialiasing on linux? Each variant undoes one candidate, then compares against master's
// linux baseline. Delete this file before merge.
import { test, expect, type Page } from '@playwright/test';

async function setup(page: Page): Promise<void> {
  await page.goto('/');
  const button = page.locator('#theme-toggle');
  await button.click();
  await button.click();
  await expect(button).toHaveText('Theme: dark');
  await page.evaluate(() => {
    const c = document.getElementById('gantt')!;
    c.style.height = '110px';
    c.scrollTop = 50;
  });
}

const variants: Record<string, (page: Page) => Promise<void>> = {
  control: async () => {},
  noFrameRects: async (page) => {
    await page.evaluate(() => document.querySelectorAll('.fg-timeline__focus-row').forEach((n) => n.remove()));
  },
  noFocusToken: async (page) => {
    await page.evaluate(() => document.getElementById('gantt')!.style.removeProperty('--fg-task-focus'));
  },
  noHasRule: async (page) => {
    await page.evaluate(() => {
      for (const s of Array.from(document.styleSheets)) {
        try {
          const rules = s.cssRules;
          for (let i = rules.length - 1; i >= 0; i--) {
            const t = rules[i]!.cssText;
            if (t.includes(':has(') || t.includes('forced-colors')) s.deleteRule(i);
          }
        } catch {}
      }
    });
  },
};

for (const [name, apply] of Object.entries(variants)) {
  test(`probe ${name}`, async ({ page }) => {
    test.skip(process.platform !== 'linux', 'linux-only CI probe');
    await setup(page);
    await apply(page);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
    await expect(page.locator('#gantt')).toHaveScreenshot('probe.png');
  });
}
