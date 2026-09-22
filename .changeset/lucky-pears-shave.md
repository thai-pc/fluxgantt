---
'@fluxgantt/core': minor
---

Scaffold i18n: `GanttConfig.messages` and `GanttConfig.ariaLabel`

English stays the only language core ships. What is new is the structure by which a host supplies
another one — and a fix to the shape that made the old string untranslatable in principle.

- **`messages.taskLabel`** replaces the per-task `aria-label` sentence wholesale. It receives all
  of the state (`name`, Intl-formatted `startLabel`/`endLabel`, localized `progressPct`,
  `isCritical`, `isSelected`, `locale`) and returns a finished string. A fragment table was
  deliberately rejected: the built-in label used to compose by appending (`base` + `', critical
  path'` + `', selected'`), which no verb-final or inflecting language can accept no matter which
  fragments are swapped in. Whole sentences also mean zero message-format parser bytes.
- **`ariaLabel`** names the chart as a whole. It existed on both renderer option types but was
  unreachable through the facade, so `'Gantt chart'` was un-overridable — including in the
  `<title>` of every exported SVG/PNG, which now follows the host's value.
- **`progressPct` is now localized.** The dates went through `Intl` but `Math.round()` did not, so
  an `ar-EG` or `hi-IN` host got Western Arabic digits beside Arabic-Indic ones in one sentence.
- A host formatter that throws or returns a non-string falls back to the English sentence, and its
  return value is coerced and capped at 400 characters. The fallback is deliberately **silent**:
  this runs once per task per repaint, so a `console.warn` would emit thousands of identical lines
  in a single paint of a large chart.

Additive and non-breaking — with no `messages`, the output is byte-identical to before (no visual
baseline moved). Both fields are read once at `mount()`, like `locale`; there is no `setMessages()`.
React and Vue inherit them structurally, with no wrapper changes.

Also: the two renderer-option builders in `render/mixin.ts` were merged into one. The
`withRender + withInteraction` budget moved 19 → 19.5 KiB — see CLAUDE.md golden rule 5 for the
measurements behind that exception.
