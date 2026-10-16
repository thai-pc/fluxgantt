import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createTimeScale,
  computeGridColumns,
  computeHeaderTiers,
  selectHeaderLabels,
  estimateTextWidth,
  HEADER_FONT_PX,
  type HeaderLabel,
  type HeaderSpan,
  type HeaderTiers,
} from '../../src/render/renderer-base.js';
import type { ViewMode } from '../../src/types.js';
import { DEFAULT_CALENDAR, normalizeDate } from '../../src/compute/working-calendar.js';

const GAP = 4;
const MODES: readonly ViewMode[] = ['day', 'week', 'month', 'quarter', 'year'];

/**
 * Real advance widths measured in Chromium (`getBBox` on an SVG `<text>` at 12px
 * `system-ui, sans-serif`, macOS): per locale and header format, the sample with the HIGHEST
 * real/estimate ratio over 12 months x 11 days. Format: [locale, text, measured px].
 * Re-measure with a headless Chromium when the estimator constants change.
 */
const MEASURED: readonly (readonly [string, string, number])[] = [
  ["en", "4 Wed", 36.4],
  ["en", "4", 7.7],
  ["en", "May 2026", 56.5],
  ["en", "2026", 29.7],
  ["en", "May", 23.4],
  ["de", "Mo., 6.", 38.8],
  ["de", "4", 7.7],
  ["de", "Aug. 2026", 58.7],
  ["de", "2026", 29.7],
  ["de", "Nov", 22.3],
  ["fr", "sam. 4", 38],
  ["fr", "4", 7.7],
  ["fr", "déc. 2026", 57.6],
  ["fr", "2026", 29.7],
  ["fr", "déc.", 24.5],
  ["ru", "пн, 28", 36.1],
  ["ru", "4", 7.7],
  ["ru", "май 2026 г.", 67.5],
  ["ru", "2026", 29.7],
  ["ru", "май", 23],
  ["pl", "czw., 8", 39.8],
  ["pl", "4", 7.7],
  ["pl", "mar 2026", 54.7],
  ["pl", "2026", 29.7],
  ["pl", "mar", 21.6],
  ["pt", "dom., 6", 43],
  ["pt", "4", 7.7],
  ["pt", "ago. de 2026", 75.1],
  ["pt", "2026", 29.7],
  ["pt", "ago.", 24.5],
  ["el", "Παρ 28", 41.7],
  ["el", "4", 7.7],
  ["el", "Μαρ 2026", 58.1],
  ["el", "2026", 29.7],
  ["el", "Μαρ", 25.1],
  ["ja", "4日(日)", 40.7],
  ["ja", "8日", 19.6],
  ["ja", "2026年4月", 61.3],
  ["ja", "2026年", 41.6],
  ["ja", "8月", 19.6],
  ["zh", "4日周日", 43.5],
  ["zh", "8日", 19.6],
  ["zh", "2026年4月", 61.3],
  ["zh", "2026年", 41.6],
  ["zh", "8月", 19.6],
  ["ko", "8일 (화)", 41],
  ["ko", "4일", 18.1],
  ["ko", "2026년 4월", 61.5],
  ["ko", "2026년", 40.1],
  ["ko", "4월", 18.1],
  ["ar", "الخميس، 28", 60.7],
  ["ar", "4", 7.7],
  ["ar", "أغسطس 2026", 73.7],
  ["ar", "2026", 29.7],
  ["ar", "أغسطس", 40.6],
  ["fa", "جمعه ۶م", 43.8],
  ["fa", "۳", 7.5],
  ["fa", "دی ۱۴۰۵", 38.7],
  ["fa", "۱۴۰۵", 20.6],
  ["fa", "دی", 14.7],
  ["he", "שבת ה-4", 49.5],
  ["he", "4", 7.7],
  ["he", "מרץ 2026", 55.2],
  ["he", "2026", 29.7],
  ["he", "מרץ", 22.1],
  ["vi", "CN, ngày 4", 62.8],
  ["vi", "4", 7.7],
  ["vi", "thg 9 2026", 62.8],
  ["vi", "2026", 29.7],
  ["vi", "Tháng 4", 46.7],
  ["th", "พฤหัส 28", 48.6],
  ["th", "4", 7.7],
  ["th", "พ.ค. 2569", 56.5],
  ["th", "พ.ศ. 2569", 56.5],
  ["th", "พ.ค.", 23.1],
  ["hi", "सोम 28", 37.8],
  ["hi", "4", 7.7],
  ["hi", "मई 2026", 48],
  ["hi", "2026", 29.7],
  ["hi", "मई", 14.9],
  ["bn", "৬ সোম", 35.6],
  ["bn", "৬", 8.7],
  ["bn", "আগ ২০২৬", 56.3],
  ["bn", "২০২৬", 29.9],
  ["bn", "ফেব", 21.6],
  ["ta", "28 வெள்.", 51.7],
  ["ta", "4", 7.7],
  ["ta", "ஜன. 2026", 57.4],
  ["ta", "2026", 29.7],
  ["ta", "ஜன.", 24.3],
  ["kn", "6 ಸೋಮ", 49.8],
  ["kn", "4", 7.7],
  ["kn", "ಮೇ 2026", 53.6],
  ["kn", "2026", 29.7],
  ["kn", "ಮೇ", 20.6],
  ["pa", "4, Wed", 39.5],
  ["pa", "4", 7.7],
  ["pa", "2026 M04", 58.8],
  ["pa", "2026", 29.7],
  ["pa", "M04", 25.8],
];

function build(viewMode: ViewMode, locale: string, start: string, end: string, tz = 'UTC') {
  const calendar = { ...DEFAULT_CALENDAR, timezone: tz };
  const range = {
    start: normalizeDate(`${start}T00:00`, tz),
    end: normalizeDate(`${end}T00:00`, tz),
  };
  const ts = createTimeScale(range, viewMode, calendar);
  const cols = computeGridColumns(ts, viewMode, calendar, locale, range.start);
  return { ts, cols, tiers: computeHeaderTiers(ts, viewMode, locale, cols) };
}

/** [left, right] of a kept label under the estimator (upper: start-anchored, lower: centred). */
function box(l: HeaderLabel, upper: boolean): [number, number] {
  const w = estimateTextWidth(l.text);
  return upper ? [l.x, l.x + w] : [l.x - w / 2, l.x + w / 2];
}

function expectTiersSound(tiers: HeaderTiers, total: number): void {
  for (const [tier, upper] of [
    [tiers.upper, true],
    [tiers.lower, false],
  ] as const) {
    let prevRight = -Infinity;
    for (const l of tier) {
      const [left, right] = box(l, upper);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(right).toBeLessThanOrEqual(total + 1e-9);
      expect(left).toBeGreaterThanOrEqual(prevRight + GAP - 1e-9);
      prevRight = right;
    }
  }
}

describe('estimateTextWidth', () => {
  it('is 0 for the empty string and additive over characters', () => {
    expect(estimateTextWidth('')).toBe(0);
    expect(estimateTextWidth('Mon 27')).toBeCloseTo(
      estimateTextWidth('Mon') + estimateTextWidth(' ') + estimateTextWidth('27'),
    );
  });

  it('charges space and ASCII punctuation less than letters, CJK more than Latin', () => {
    expect(estimateTextWidth(' .,:;()-/')).toBeCloseTo(9 * 0.35 * HEADER_FONT_PX);
    expect(estimateTextWidth('a')).toBeLessThan(estimateTextWidth('A'));
    expect(estimateTextWidth('日')).toBeGreaterThan(estimateTextWidth('a'));
  });

  it('handles surrogate pairs without NaN', () => {
    expect(Number.isFinite(estimateTextWidth('\u{1F600}'))).toBe(true);
  });

  it('every branch of the width table', () => {
    // [sample, em per code unit]
    for (const [ch, em] of [
      ['.', 0.35],
      ['7', 0.7],
      ['M', 0.8],
      ['α', 0.8],
      ['म', 1.2],
      ['ก', 0.7],
      ['日', 1],
    ] as const)
      expect(estimateTextWidth(ch)).toBeCloseTo(em * HEADER_FONT_PX);
  });

  it.each(MEASURED)('%s %j: estimate >= measured %d px', (_locale, text, real) => {
    expect(estimateTextWidth(text)).toBeGreaterThanOrEqual(real);
  });
});

describe('selectHeaderLabels', () => {
  const span = (x: number, width: number, text: string): HeaderSpan => ({ x, width, text });

  it('empty input and a single label', () => {
    expect(selectHeaderLabels([], 100, false)).toEqual([]);
    expect(selectHeaderLabels([span(0, 60, '1')], 100, false)).toEqual([{ x: 30, text: '1' }]);
  });

  it('upper labels are left-aligned with padding and must fit their span', () => {
    expect(selectHeaderLabels([span(100, 200, 'Aug 2026')], 400, true)).toEqual([
      { x: 100 + GAP, text: 'Aug 2026' },
    ]);
    expect(selectHeaderLabels([span(100, 60, 'Aug 2026')], 400, true)).toEqual([]);
  });

  it('lower labels are centred on their span and may be wider than it, but not leave the chart', () => {
    expect(selectHeaderLabels([span(0, 8, 'Jan')], 100, false)).toHaveLength(0); // left < 0
    expect(selectHeaderLabels([span(10, 8, 'Jan')], 100, false)).toEqual([{ x: 14, text: 'Jan' }]);
  });

  it('drops labels outside [0, totalWidth]', () => {
    expect(selectHeaderLabels([span(95, 10, '12')], 100, false)).toEqual([]);
    expect(selectHeaderLabels([span(90, 200, 'Aug 2026')], 100, true)).toEqual([]);
  });

  it('property: kept labels are a subsequence, inside the chart, and gap-separated', () => {
    const arb = fc.record({
      total: fc.integer({ min: 50, max: 2000 }),
      upper: fc.boolean(),
      items: fc.array(
        fc.record({
          dx: fc.integer({ min: 0, max: 100 }),
          width: fc.integer({ min: 1, max: 120 }),
          text: fc.string({ minLength: 1, maxLength: 8 }),
        }),
        { maxLength: 40 },
      ),
    });
    fc.assert(
      fc.property(arb, ({ total, upper, items }) => {
        let x = 0;
        const spans = items.map((i) => {
          x += i.dx;
          return span(x, i.width, i.text);
        });
        const out = selectHeaderLabels(spans, total, upper);
        let k = 0;
        let prevRight = -Infinity;
        for (const l of out) {
          while (k < spans.length && spans[k]!.text !== l.text) k++;
          expect(k).toBeLessThan(spans.length);
          k++;
          const w = estimateTextWidth(l.text);
          const left = upper ? l.x : l.x - w / 2;
          expect(left).toBeGreaterThanOrEqual(0);
          expect(left + w).toBeLessThanOrEqual(total + 1e-9);
          expect(left).toBeGreaterThanOrEqual(prevRight + GAP - 1e-9);
          prevRight = left + w;
        }
      }),
    );
  });
});

describe('computeHeaderTiers', () => {
  const LOCALES = ['en', 'de', 'fr', 'ja', 'vi', 'ar', 'th', 'ta'];

  it.each(MODES.flatMap((m) => LOCALES.map((l) => [m, l] as const)))(
    '%s / %s: no overlap, nothing outside the chart',
    (mode, locale) => {
      for (const [s, e] of [
        ['2026-01-28', '2026-03-20'],
        ['2026-07-04', '2026-09-10'],
        ['2024-02-10', '2027-05-03'],
      ] as const) {
        const { ts, tiers } = build(mode, locale, s, e);
        expectTiersSound(tiers, ts.totalWidth);
      }
    },
  );

  it('right edge: the final month label is not cut off by the phantom last column', () => {
    for (const [mode, s, e] of [
      ['day', '2026-07-15', '2026-08-02'],
      ['month', '2026-07-04', '2026-09-10'],
    ] as const) {
      const { ts, tiers } = build(mode, 'en', s, e);
      expectTiersSound(tiers, ts.totalWidth);
      for (const l of tiers.upper) expect(box(l, true)[1]).toBeLessThanOrEqual(ts.totalWidth);
    }
  });

  it('left edge: a partial first month is dropped, not drawn into the label column', () => {
    const y = build('year', 'en', '2026-01-28', '2026-12-31');
    expect(y.tiers.lower[0]!.text).toBe('Feb');
    const q = build('quarter', 'en', '2026-01-29', '2026-12-31');
    expect(q.tiers.lower[0]!.text).toBe('Feb');
    expect(q.tiers.upper[0]!.text).toBe('2026');
  });

  it('upper labels are left-aligned at their span start with padding', () => {
    const { tiers } = build('day', 'en', '2026-03-01', '2026-05-15');
    expect(tiers.upper.map((l) => l.text)).toEqual(['Mar 2026', 'Apr 2026', 'May 2026']);
    expect(tiers.upper[0]!.x).toBe(GAP);
    expect(tiers.upper[1]!.x).toBe(31 * 60 + GAP);
  });

  it.each(['en', 'de', 'fr', 'ja', 'ko', 'pt'])(
    'day view keeps EVERY day label in %s (no regression versus unthinned master)',
    (locale) => {
      const { ts, cols, tiers } = build('day', locale, '2026-03-01', '2026-04-01');
      const visible = cols.filter((c) => c.x < ts.totalWidth);
      expect(visible).toHaveLength(31);
      expect(tiers.lower.map((l) => l.text)).toEqual(visible.map((c) => c.label));
    },
  );

  it('day view drops only the labels that genuinely overflow (pl Sundays, "niedz." is ~56px of 60)', () => {
    const { cols, tiers } = build('day', 'pl', '2026-03-01', '2026-04-01');
    const kept = new Set(tiers.lower.map((l) => l.text));
    const others = cols.slice(0, 31).filter((c) => !c.label.startsWith('niedz'));
    expect(others).toHaveLength(26);
    for (const c of others) expect(kept.has(c.label)).toBe(true);
    expect(tiers.lower.length).toBeLessThan(31);
    expectTiersSound(tiers, 31 * 60);
  });

  it('week view lower labels are the day number only; day view carries the weekday', () => {
    const w = build('week', 'en', '2026-03-02', '2026-03-20');
    expect(w.tiers.lower.every((l) => /^\d+$/.test(l.text))).toBe(true);
    expect(w.tiers.lower).toHaveLength(18);
    const d = build('day', 'en', '2026-03-02', '2026-03-20');
    expect(d.tiers.lower[0]!.text).toBe('2 Mon');
  });

  it('month view uses ONE uniform stride across month boundaries', () => {
    const { tiers } = build('month', 'en', '2026-01-01', '2026-06-30');
    const xs = tiers.lower.map((l) => l.x);
    expect(xs.length).toBeGreaterThan(20);
    const step = xs[1]! - xs[0]!;
    expect(step).toBeGreaterThan(8);
    xs.forEach((x, k) => expect(x - xs[0]!).toBe(k * step));
  });

  it('year view: year spans above, month names below', () => {
    const { tiers } = build('year', 'en', '2025-01-01', '2027-12-31');
    expect(tiers.upper.map((l) => l.text)).toEqual(['2025', '2026', '2027']);
    expect(tiers.lower.map((l) => l.text).slice(0, 3)).toEqual(['Jan', 'Mar', 'May']);
  });

  it.each(['America/New_York', 'Asia/Ho_Chi_Minh', 'UTC'])(
    'column index == day index (%s, across DST changes)',
    (tz) => {
      // Independent of dateToX: format start + i days directly and compare with col.label.
      const start = '2026-03-01';
      const { cols } = build('week', 'en', start, '2026-11-15', tz);
      const first = normalizeDate(`${start}T00:00`, tz).toPlainDate();
      for (const i of [0, 1, 7, 8, 9, 100, 250]) {
        expect(cols[i]!.label).toBe(
          first.add({ days: i }).toLocaleString('en', { day: 'numeric' }),
        );
      }
    },
  );

  it('memoizes on (range, viewMode, locale) and recomputes when an input changes', () => {
    const a = build('week', 'en', '2026-03-02', '2026-04-20');
    expect(computeHeaderTiers(a.ts, 'week', 'en', a.cols)).toBe(a.tiers);
    const b = build('week', 'de', '2026-03-02', '2026-04-20');
    expect(b.tiers).not.toBe(a.tiers);
    const c = build('week', 'en', '2026-03-02', '2026-04-20');
    expect(c.tiers).not.toBe(b.tiers);
    expect(c.tiers).toEqual(a.tiers);
  });
});
