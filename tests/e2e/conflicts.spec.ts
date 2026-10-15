import { test, expect, type Page } from '@playwright/test';
import { DEFAULT_PIXELS_PER_DAY, centreOf, mouseDrag } from '../helpers/drag.js';

// Conflict detection e2e (T3 detect-conflicts, spec-detect-conflicts.md §7 "For the UI/UX tester").
// Fixture: `examples/plain-html-demo/conflicts.html` (`src/conflicts.ts`) — `withConflicts` composed
// on a chart `phase { a -> b -> c }` (FS chain, children inside the summary). There is no render hook
// in v1, so the assertions are on the `conflict:detected` payloads, the pure `detectConflicts()`
// query, and the fixture's own polite status region.
//
// The event fires from a MICROTASK after the mutation, so every read polls instead of asserting
// synchronously. "No event" assertions wait a few frames first so a late emission cannot slip past.

type Payload = { kind: string; to?: string; from?: string; dependencyType?: string; taskId?: string; parentId?: string; edge?: string }[];

async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/conflicts.html${query}`);
  await expect(page.locator('#gantt svg, #gantt canvas').first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean((window as never as { __gantt?: unknown }).__gantt))).toBe(true);
}

/** Subscribes through the public `on()` and stores each payload (reduced to plain data). */
async function record(page: Page): Promise<() => Promise<Payload[]>> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __gantt: { on(e: string, cb: (c: Payload) => void): unknown };
      __conflicts: Payload[];
    };
    w.__conflicts = [];
    w.__gantt.on('conflict:detected', (conflicts) => {
      w.__conflicts.push(
        conflicts.map((c) => ({
          kind: c.kind,
          to: c.to,
          from: c.from,
          dependencyType: c.dependencyType,
          taskId: c.taskId,
          parentId: c.parentId,
          edge: c.edge,
        })),
      );
    });
  });
  return () => page.evaluate(() => (window as never as { __conflicts: Payload[] }).__conflicts);
}

const detect = (page: Page): Promise<Payload> =>
  page.evaluate(() =>
    (window as never as { __gantt: { detectConflicts(): Payload } }).__gantt
      .detectConflicts()
      .map((c) => ({ kind: c.kind, to: c.to, from: c.from, taskId: c.taskId, parentId: c.parentId, edge: c.edge })),
  );

const settle = (page: Page): Promise<unknown> =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

const barCentre = (page: Page, id: string) => centreOf(page.locator(`[data-task-id="${id}"] .fg-task__bar`));

async function edgeOf(page: Page, id: string): Promise<{ x: number; y: number }> {
  // Right-edge resize zone, see drag-resize.spec.ts for the 4 < inset <= 8 derivation.
  const bar = page.locator(`[data-task-id="${id}"] .fg-task__bar`);
  await bar.scrollIntoViewIfNeeded();
  const box = await bar.boundingBox();
  if (!box) throw new Error(`no box for ${id}`);
  return { x: box.x + box.width - 6, y: box.y + box.height / 2 };
}

test.describe('manual scheduling mode', () => {
  test('dragging a successor before its FS predecessor ends fires exactly one dependency-violation naming a -> b; dragging it back fires []', async ({
    page,
  }) => {
    await open(page, '?mode=manual');
    const events = await record(page);

    await mouseDrag(page, await barCentre(page, 'b'), -DEFAULT_PIXELS_PER_DAY * 2);

    await expect.poll(async () => (await events()).length).toBe(1);
    expect((await events())[0]).toEqual([
      expect.objectContaining({ kind: 'dependency-violation', from: 'a', to: 'b', dependencyType: 'FS' }),
    ]);
    await settle(page);
    expect(await events()).toHaveLength(1);

    // The query agrees with the event, and the fixture's own status region mirrors it.
    expect(await detect(page)).toEqual([expect.objectContaining({ kind: 'dependency-violation', from: 'a', to: 'b' })]);
    await expect(page.locator('#conflict-status')).toHaveText('1 schedule conflict');
    await expect(page.locator('#conflict-list li')).toHaveText([/Dependency violation: b starts before a allows \(FS\)/]);

    await mouseDrag(page, await barCentre(page, 'b'), DEFAULT_PIXELS_PER_DAY * 2);

    await expect.poll(async () => (await events()).length).toBe(2);
    expect((await events())[1]).toEqual([]);
    expect(await detect(page)).toEqual([]);
    await expect(page.locator('#conflict-status')).toHaveText('No schedule conflicts');
    await expect(page.locator('#conflict-list li')).toHaveCount(0);
  });

  test('a drag that leaves the conflict set unchanged re-emits nothing', async ({ page }) => {
    await open(page, '?mode=manual');
    const events = await record(page);
    await mouseDrag(page, await barCentre(page, 'b'), -DEFAULT_PIXELS_PER_DAY * 2);
    await expect.poll(async () => (await events()).length).toBe(1);

    // Move c (no new violation, still inside the phase): the set is unchanged, so no emission.
    await mouseDrag(page, await barCentre(page, 'c'), DEFAULT_PIXELS_PER_DAY);
    await settle(page);
    expect(await events()).toHaveLength(1);
  });

  test('keyboard: Ctrl/Cmd+Z restores the schedule and emits [], Ctrl/Cmd+Shift+Z brings the conflict back', async ({
    page,
  }) => {
    await open(page, '?mode=manual');
    const events = await record(page);
    await mouseDrag(page, await barCentre(page, 'b'), -DEFAULT_PIXELS_PER_DAY * 2);
    await expect.poll(async () => (await events()).length).toBe(1);

    // Keyboard handling is attached to a focused row; click selects + focuses it.
    await page.locator('.fg-timeline__row[data-task-id="b"]').focus();
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+z`);

    await expect.poll(async () => (await events()).length).toBe(2);
    expect((await events())[1]).toEqual([]);
    expect(await detect(page)).toEqual([]);

    await page.keyboard.press(`${mod}+Shift+z`);
    await expect.poll(async () => (await events()).length).toBe(3);
    expect((await events())[2]).toEqual([expect.objectContaining({ kind: 'dependency-violation', to: 'b' })]);
  });

  test('drag-resizing a child past its summary parent produces outside-parent (edge end); resizing back clears it', async ({
    page,
  }) => {
    await open(page, '?mode=manual');
    const events = await record(page);

    await mouseDrag(page, await edgeOf(page, 'c'), DEFAULT_PIXELS_PER_DAY * 3);

    await expect.poll(async () => (await events()).length).toBe(1);
    expect((await events())[0]).toEqual([
      expect.objectContaining({ kind: 'outside-parent', taskId: 'c', parentId: 'phase', edge: 'end' }),
    ]);

    await mouseDrag(page, await edgeOf(page, 'c'), -DEFAULT_PIXELS_PER_DAY * 3);
    await expect.poll(async () => (await events()).length).toBe(2);
    expect((await events())[1]).toEqual([]);
  });

  test('a chart that already has conflicts emits nothing on subscribe; detectConflicts() returns them; the first edit that changes the set emits', async ({
    page,
  }) => {
    await open(page, '?mode=manual&seed=conflict&listen=0');
    // Before the spec subscribes, the fixture rendered the initial state itself from the query.
    await expect(page.locator('#conflict-status')).toHaveText('1 schedule conflict');
    const events = await record(page);
    await settle(page);
    expect(await events()).toEqual([]);
    expect(await detect(page)).toEqual([expect.objectContaining({ kind: 'dependency-violation', from: 'a', to: 'b' })]);

    // Drag b right by 2 days: now starts at/after a's end -> the conflict clears.
    await mouseDrag(page, await barCentre(page, 'b'), DEFAULT_PIXELS_PER_DAY * 2);
    await expect.poll(async () => (await events()).length).toBe(1);
    expect((await events())[0]).toEqual([]);
  });
});

test.describe('automatic scheduling mode', () => {
  test('dragging the predecessor later cascades the successors: no conflict:detected at all', async ({ page }) => {
    await open(page, '?mode=auto');
    const events = await record(page);
    const bBefore = await page.evaluate(() =>
      String((window as never as { __gantt: { getTasks(): { id: string; start: unknown }[] } }).__gantt.getTasks().find((t) => t.id === 'b')!.start),
    );

    await mouseDrag(page, await barCentre(page, 'a'), DEFAULT_PIXELS_PER_DAY);

    // The cascade really ran (b was pushed), yet the transient state was never announced.
    await expect
      .poll(() =>
        page.evaluate(
          (before) =>
            String((window as never as { __gantt: { getTasks(): { id: string; start: unknown }[] } }).__gantt.getTasks().find((t) => t.id === 'b')!.start) !== before,
          bBefore,
        ),
      )
      .toBe(true);
    await settle(page);
    expect(await events()).toEqual([]);
    expect(await detect(page)).toEqual([]);
    await expect(page.locator('#conflict-status')).toHaveText('No schedule conflicts');
  });

  test('the dragged successor itself stays authoritative: moving b before a ends reports a violation with to === b', async ({
    page,
  }) => {
    await open(page, '?mode=auto');
    const events = await record(page);

    await mouseDrag(page, await barCentre(page, 'b'), -DEFAULT_PIXELS_PER_DAY * 2);

    await expect.poll(async () => (await events()).length).toBe(1);
    expect((await events())[0]).toEqual([expect.objectContaining({ kind: 'dependency-violation', from: 'a', to: 'b' })]);
  });
});

test.describe('Canvas renderer (2100 tasks)', () => {
  // Pointer drag is an SVG-only interaction (the interaction disposers are inert in Canvas mode,
  // see the unit test "readOnly: true in Canvas mode"), so edits go through the public API; the
  // watcher is renderer-independent and that is what this proves.
  test('conflict:detected fires on a programmatic edit and clears on revert, with the status region in step', async ({
    page,
  }) => {
    await page.goto('/conflicts.html?mode=manual&pad=2100');
    await expect(page.locator('#gantt canvas').first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => Boolean((window as never as { __gantt?: unknown }).__gantt))).toBe(true);
    const events = await record(page);

    await page.evaluate(() => {
      const g = (window as never as { __gantt: { moveTask(id: string, s: string): unknown } }).__gantt;
      g.moveTask('b', '2026-08-03');
    });
    await expect.poll(async () => (await events()).length).toBe(1);
    expect((await events())[0]).toEqual([expect.objectContaining({ kind: 'dependency-violation', from: 'a', to: 'b' })]);
    await expect(page.locator('#conflict-status')).toHaveText('1 schedule conflict');

    await page.evaluate(() => (window as never as { __gantt: { undo(): unknown } }).__gantt.undo());
    await expect.poll(async () => (await events()).length).toBe(2);
    expect((await events())[1]).toEqual([]);
  });
});
