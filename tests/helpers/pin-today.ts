import type { Page } from '@playwright/test';

/**
 * Pins the renderer's notion of "now" for a page, so today-marker tests are deterministic.
 *
 * `page.clock.setFixedTime()` is NOT enough here: it fakes `Date`, and the Temporal polyfill
 * derives from `Date.now` — but modern browsers ship Temporal NATIVELY, and the native
 * implementation reads the system clock directly, so `Temporal.Now` sails straight past a
 * faked `Date`. This shim therefore patches `Temporal.Now`'s two instant getters directly,
 * which is the only thing the renderers actually call.
 *
 * Must be installed BEFORE `page.goto` (it runs in every new document, ahead of page script).
 */
export async function pinToday(page: Page, isoInstant: string): Promise<void> {
  await page.addInitScript((iso: string) => {
    const install = (): boolean => {
      const T = (globalThis as { Temporal?: Record<string, unknown> }).Temporal;
      const Now = T?.Now as
        | { instant?: () => unknown; zonedDateTimeISO?: (tz: string) => unknown }
        | undefined;
      if (!Now?.zonedDateTimeISO) return false;
      const Instant = (T as { Instant: { from: (s: string) => { toZonedDateTimeISO: (tz: string) => unknown } } })
        .Instant;
      const fixed = Instant.from(iso);
      Now.instant = (): unknown => fixed;
      Now.zonedDateTimeISO = (tz: string): unknown => fixed.toZonedDateTimeISO(tz);
      return true;
    };
    // Native Temporal exists immediately; a polyfilled one is assigned by page script, so
    // retry on DOMContentLoaded as well rather than assuming either ordering.
    if (!install()) document.addEventListener('DOMContentLoaded', install, { once: true });
  }, isoInstant);
}
