// The ONE place grid mixins turn a `GanttAnnouncement` into live-region text (spec-grid-columns.md
// section 4.6, G0 review decision): `messages.announce` with its try/catch, the `typeof === 'string'`
// check, the English fallback and the length cap. `internal.announce` takes final text, so every
// grid and grid-editing announcement goes through here.
import type { GanttInternal } from '../gantt-internal.js';
import type { GanttAnnouncement } from '../types.js';

/** Longest announcement written to the live region. */
export const MAX_ANNOUNCE_CHARS = 400;

/** The text for `a`: the host's `messages.announce` when it returns a string, else `fallback`. */
export function announceText(
  messages: { readonly announce?: (a: GanttAnnouncement) => string } | undefined,
  a: GanttAnnouncement,
  fallback: string,
): string {
  let text = fallback;
  try {
    const custom = messages?.announce?.(a);
    if (typeof custom === 'string') text = custom;
  } catch {
    // a throwing host function falls back to the English text
  }
  return text.slice(0, MAX_ANNOUNCE_CHARS);
}

/** Announces `a` through the `withInteraction` live region; silent when none is composed. */
export function announceGrid(internal: GanttInternal, a: GanttAnnouncement, fallback: string): void {
  internal.announce?.(announceText(internal.config.messages, a, fallback));
}
