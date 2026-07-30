---
"@fluxgantt/core": minor
---

feat(core): drag-move interaction

Add `enableDragMove(handle, getTasks, options)` — pointer-drag a task bar horizontally to
change its `start`/`end` (duration preserved), committing once on drop via an
`onTaskMoved` callback. Headless of any framework (raw Pointer Events); no `TaskStore`
coupling — the caller decides what to do in the callback. Day-snapped and DST-safe: the
new dates are computed with calendar arithmetic (`.add({ days: N })`), never elapsed-time,
so wall-clock time-of-day is preserved across DST boundaries.

Also adds `SvgRendererHandle.getTimeScale()` so the interaction layer can convert pixels to
dates through the renderer's single source of truth.

Hardened per security review: `handle.destroy()` mid-drag now tears down the gesture (no
leaked window listeners / detached DOM), the day-delta is clamped so a pathological pointer
coordinate can't throw a Temporal `RangeError`, and a second concurrent pointerdown is
ignored so a two-finger gesture can't orphan the first drag.
