---
'@fluxgantt/core': patch
---

Fix: editing a task on a long date range no longer stalls the chart. The critical-path slack loop walked every day between each task's early and late start, so one `updateTask` on 2000 tasks over a 520-working-day window cost about 8 s of CPU on a quiet machine. Slack now reads from one shared working-hours table, and the same edit costs about 0.7 s (about 12x less). Two smaller causes of the same cost are fixed too: date-only strings such as `'2026-03-02'` no longer go through a thrown-and-caught `Instant.from` on every normalization, and the aria-label date cache no longer clears mid-paint on ranges with more than 512 distinct dates (the cap is now 4096, and the cache is emptied when the last chart is destroyed).

Results match the previous per-pair day walk for every input CPM and `differenceInWorkingHours` produce, including DST, holidays and ZonedDateTimes in another zone or calendar. One historical edge differs for a table built wider than the reading: a day a zone skipped entirely (Pacific/Apia, 2011-12-30). No API, option or event change.
