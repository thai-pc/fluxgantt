// The shared announcement helper (spec-grid-columns.md 4.6): messages.announce with fallback and cap.
import { describe, it, expect, vi } from 'vitest';
import { announceGrid, announceText, MAX_ANNOUNCE_CHARS } from '../../src/grid/announce.js';
import type { GanttInternal } from '../../src/gantt-internal.js';
import type { GanttAnnouncement } from '../../src/types.js';

const resized: GanttAnnouncement = { kind: 'column-resized', columnId: 'start', header: 'Start', width: 120, locale: 'en' };
const edited: GanttAnnouncement = { kind: 'cell-edited', id: 'a' as never, name: 'A', columnId: 'start', header: 'Start', text: 'Jan 5', locale: 'en' };
const failed: GanttAnnouncement = { kind: 'cell-edit-failed', id: 'a' as never, name: 'A', columnId: 'start', header: 'Start', reason: 'not-a-date', locale: 'en' };

describe('announceText', () => {
  it('uses the English fallback without a host function', () => {
    expect(announceText(undefined, resized, 'Start column resized to 120 pixels')).toBe('Start column resized to 120 pixels');
    expect(announceText({}, resized, 'fb')).toBe('fb');
  });

  it('passes the announcement to the host function and uses its string', () => {
    const announce = vi.fn((a: GanttAnnouncement) => `host:${a.kind}`);
    expect(announceText({ announce }, resized, 'fb')).toBe('host:column-resized');
    expect(announceText({ announce }, edited, 'fb')).toBe('host:cell-edited');
    expect(announceText({ announce }, failed, 'fb')).toBe('host:cell-edit-failed');
    expect(announce).toHaveBeenCalledWith(resized);
  });

  it('falls back when the host function throws or returns a non-string', () => {
    expect(announceText({ announce: () => { throw new Error('x'); } }, resized, 'fb')).toBe('fb');
    for (const bad of [undefined, null, 5, {}, ['a']]) {
      expect(announceText({ announce: () => bad as never }, resized, 'fb')).toBe('fb');
    }
  });

  it('caps both the host text and the fallback', () => {
    expect(announceText({ announce: () => 'x'.repeat(10_000) }, resized, 'fb')).toHaveLength(MAX_ANNOUNCE_CHARS);
    expect(announceText(undefined, resized, 'y'.repeat(10_000))).toHaveLength(MAX_ANNOUNCE_CHARS);
  });
});

describe('announceGrid', () => {
  const internal = (announce: ((t: string) => void) | undefined, messages?: object) =>
    ({ announce, config: { messages } }) as unknown as GanttInternal;

  it('writes final text through internal.announce exactly once', () => {
    const say = vi.fn();
    announceGrid(internal(say), resized, 'fb');
    expect(say).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledWith('fb');
    say.mockClear();
    announceGrid(internal(say, { announce: () => 'host' }), edited, 'fb');
    expect(say).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledWith('host');
  });

  it('is silent (and does not throw) when no live region is composed', () => {
    const announce = vi.fn(() => 'host');
    expect(() => announceGrid(internal(undefined, { announce }), resized, 'fb')).not.toThrow();
    expect(announce).not.toHaveBeenCalled();
  });
});
