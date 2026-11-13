// The ONE place the grid mixins turn an announcement into text for the polite live region that
// `withInteraction` owns (spec-grid-columns.md section 4.6). `internal.announce` takes final text, so
// this applies the host's `messages.announce` (a throw or a non-string falls back to English), strips
// characters a screen reader or an XML export cannot take, and caps the length. Without
// `withInteraction` there is no region and nothing is announced.
import type { GanttInternal } from '../gantt-internal.js';
import type { GanttAnnouncement } from '../types.js';
import { UNSAFE_TEXT } from './columns.js';

/** Longest announcement, in characters (as the interaction region's own cap). */
const MAX_ANNOUNCE_CHARS = 400;

/** Announces `a`, or `english` when the host supplies no text. */
export function announceGrid(internal: GanttInternal, a: GanttAnnouncement, english: string): void {
  const write = internal.announce; // read per call: assigned on every mount, absent without withInteraction
  if (!write) return;
  let text: unknown;
  try {
    text = internal.config.messages?.announce?.(a);
  } catch {
    // a throwing host function falls back to English
  }
  write((typeof text === 'string' ? text : english).replace(UNSAFE_TEXT, ' ').slice(0, MAX_ANNOUNCE_CHARS));
}
