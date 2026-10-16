import { expect, type Page } from '@playwright/test';

/**
 * Real-browser regression guard for the timeline header (spec-header-label-overlap.md): the
 * estimator in `renderer-base.ts` is a model, `getBBox()` is the truth. Within each tier
 * (same `y`), consecutive label boxes must not intersect, and every box must lie inside the
 * chart's own horizontal extent (the header background rect: right of the label column, left
 * of the clipped right edge). Test-side measurement only — the production code never reads
 * layout.
 */
export async function expectHeaderLabelsDisjoint(page: Page, svgSelector: string): Promise<void> {
  const { tiers, chart } = await page.evaluate((sel) => {
    const bg = document.querySelector<SVGRectElement>(`${sel} .fg-timeline__header rect`)!;
    const chart = { left: bg.x.baseVal.value, right: bg.x.baseVal.value + bg.width.baseVal.value };
    const texts = Array.from(
      document.querySelectorAll<SVGTextElement>(`${sel} .fg-timeline__header-label`),
    );
    const byY = new Map<string, { left: number; right: number }[]>();
    for (const t of texts) {
      const b = t.getBBox();
      const y = t.getAttribute('y') ?? '';
      const list = byY.get(y) ?? [];
      list.push({ left: b.x, right: b.x + b.width });
      byY.set(y, list);
    }
    return { chart, tiers: Array.from(byY.values()).map((l) => l.sort((a, b) => a.left - b.left)) };
  }, svgSelector);
  expect(tiers.length).toBe(2);
  for (const tier of tiers) {
    expect(tier.length).toBeGreaterThan(0);
    for (const box of tier) {
      expect(box.left).toBeGreaterThanOrEqual(chart.left);
      expect(box.right).toBeLessThanOrEqual(chart.right);
    }
    for (let i = 1; i < tier.length; i++) {
      expect(tier[i]!.left).toBeGreaterThanOrEqual(tier[i - 1]!.right);
    }
  }
}
