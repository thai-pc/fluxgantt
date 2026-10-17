# FluxGantt — AI Context (CLAUDE.md)

> A TypeScript-first, MIT-licensed Gantt chart library. Headless engine decoupled from rendering.
> Source spec: `apps/docs/fluxgantt-spec.md` (living document, v0.1.0).

This file is the context entry point for AI. Details are split into rules under `.claude/rules/`.
**Before coding, read the relevant rule.**

## Rules (read as needed)
- @.claude/rules/project-overview.md — product, tiers, monetization, roadmap
- @.claude/rules/architecture.md — layered architecture, design principles, type system
- @.claude/rules/coding-conventions.md — naming, file layout, API style
- @.claude/rules/testing.md — testing strategy (vitest, playwright, fast-check)
- @.claude/rules/security.md — **MUST read** before touching IO/auth/cloud/AI

## Golden rules (summary, do not violate)
1. **Headless first** — core runs without a DOM (Node/Workers/tests). No DOM API imports in `store/`, `compute/`, or pure-data `io`.
2. **Framework-agnostic core** — `@fluxgantt/core` must NOT import `react`/`vue`/`svelte`. Framework opinions live only in wrappers.
3. **Date = Temporal API**, never native `Date` for any computation (timezone/DST). Native `Date` only at the I/O boundary.
4. **TypeScript strict** — no implicit `any`, branded IDs (`TaskId`, `ResourceId`...) never mixed.
5. **Tree-shakable + bundle budget** — the `Gantt` facade was split into a base class plus three opt-in mixins on their own subpath exports (`@fluxgantt/core/io`, `/render`, `/interaction`) in 2026-09, because class prototype methods can never be tree-shaken: the monolithic facade billed every consumer for IO + render + interaction bytes whether they used them or not. Budgets (gzip, all CI-measured against real fixtures in `packages/core/size-limit/`, enforced via `pnpm size` + `packages/core/.size-limit.json` — see `.claude/work/spec-bundle-size-ci.md`):

   | Fixture | Measured | Budget |
   |---|---|---|
   | `createGantt()` only (hello world) | 7.41 KiB | 9 KiB |
   | `+ withIo` | 12.46 KiB | 14 KiB |
   | `+ withRender` | 14.52 KiB | 15 KiB |
   | `+ withRender + withInteraction` | 19.00 KiB | 19.5 KiB |
   | `+ withRender + withTheme` | 15.17 KiB | 16 KiB |
   | `+ withRender + withInteraction + withResponsive` | 20.38 KiB | 21 KiB |
   | `+ withRender + withViewport` | 15.39 KiB | 16 KiB |
   | `+ withConflicts` (headless) | 9.27 KiB | 10 KiB |
   | `+ withRender + withEditHooks` (not in the kitchen sink) | 15.84 KiB | 16 KiB |
   | kitchen sink (everything = the pre-split facade) | 23.66 KiB | 24 KiB |

   Hello world went 22.3 KiB → 7.41 KiB and the fully-composed instance 34.9 KiB → 23.66 KiB (the old "full core" check measured `dist/index.js` as a plain file, which code-splitting has since hollowed out; the kitchen-sink fixture replaces it). Non-core features are plugins.

   The `withRender + withInteraction` budget was raised 19 → 19.5 KiB once, for the i18n scaffold (`GanttConfig.messages`), after the levers this rule prefers were measured and came up ~67 B short: merging the two renderer-option builders recovered only 13 B, and ~68 B of the cost is the irreducible price of threading host messages through both renderers. Justified as WCAG-adjacent — the strings in question are accessible names. Treat that as the exception it was, not a precedent: the rule is still change the shape, not the budget.

   The 2026-09 responsive/touch pass is what that rule looks like when it is followed. Its first
   measurement blew THREE budgets at once, because the coarse-pointer CSS — and the long comment
   justifying it — sat inside a template literal in `svg-renderer.ts`, and **every character inside
   those CSS template literals is shipped bytes, comments included**. The fix was not a budget
   bump: the block moved into `withResponsive()`'s own injected stylesheet on the new
   `@fluxgantt/core/responsive` subpath, which left all six pre-existing fixtures at **+0 B** and
   put the 783 B where only charts that ask for it pay. Remember the template-literal trap the next
   time a renderer needs a CSS rule.

   The 2026-10 headroom pass is the same rule followed again. After 0.3.0 two fixtures sat at 9-10 B
   of headroom (kitchen sink 24566 / 24576, `with-edit-hooks` 16375 / 16384) and the next small
   feature would have forced a bump. Nothing was raised; bytes were stripped instead (gzip bytes,
   measured one lever at a time, kitchen sink / `with-edit-hooks` / `withRender`):
   (1) the three CSS template literals that stayed in `svg-renderer.ts` after the responsive pass
   still shipped ~700 chars of comments and indentation in every render fixture; they are now
   hand-minified single-line strings with the rationale in `//` comments above them, about
   **380-390 B** off each render fixture (a unit test now fails on a `/*` in the injected `<style>`
   text); (2) five diagnostic strings lost their second sentence (every asserted substring kept;
   two of them later got a short actionable hint back after review), about **140-175 B** off each
   fixture that holds them; (3) the PNG scale/background validation that lived in three places is one
   `resolvePngOptions()`, about **8 B** and only on the kitchen sink / `+ withIo` (kept for the
   dedupe, not the bytes). Net effect of the code levers, before any measurement change:
   24566 → 24030 (546 B of headroom), 16375 → 15866 (518 B), 15026 → 14501 (859 B), with exported
   SVG output byte-identical.
   Then a measurement fix, not a code change: the size-limit fixtures used to be bundled as an IIFE,
   and esbuild prepends its CJS-interop helpers (`__toESM`, a "Dynamic require" shim) to any bundle
   holding an external dynamic `import()` — dead code no consumer's ESM bundler ships. The raw
   difference between the IIFE and ESM outputs is ~740 B (736 B measured on the kitchen sink: ~725 B
   of dead helpers plus the ~10-25 B `"use strict";(()=>{...})()` wrapper), worth 5-322 B gzip
   depending on the fixture (5-6 B on the two without an external `import()`). `fixtureConfig()` now
   sets `format: 'esm'`, so **fixtures measure ESM output**; the bundled modules are unchanged (same
   inputs, same `external` list, identical per-input bytes in esbuild's metafile). One caveat:
   size-limit subtracts a fixed 32 B "empty project" calibration, which is the gzip of an empty IIFE;
   an empty ESM output gzips to ~20 B, so ESM figures read about 12 B lower than the true
   bundle (negligible next to the headroom, but real). Before / after (bytes):
   hello world 7684 → 7679, `+ withIo` 13225 → 12903, `+ withRender` 14501 → 14196,
   `+ withRender + withInteraction` 19157 → 18837, `+ withRender + withTheme` 15031 → 14723 (then → ~14830 with construction-time theme validation + host `--fg-*` override restore, ~+110 B),
   `+ withRender + withInteraction + withResponsive` 19957 → 19639, `+ withRender + withViewport`
   15417 → 15112, `+ withConflicts` 9603 → 9597, `+ withRender + withEditHooks` 15866 → 15549,
   kitchen sink 24030 → 23711. No limit moved. Headroom is now 865 B (kitchen sink) and 835 B
   (`with-edit-hooks`); the tightest fixture is `+ withConflicts` at 643 B. `pnpm --filter
   @fluxgantt/core size:headroom` (a non-fatal CI step) warns on any fixture under 150 B so it does
   not silently erode again. Do not spend the room by raising or lowering a limit; spend it on
   features.

   The export-background change (SVG/PNG exports carry the resolved `--fg-bg`) cost +106 B on the kitchen sink and +111 B on `+ withIo` (24410 -> 24516, 12901 -> 13012) and left the other eight fixtures at +0 B. Headroom was recovered, not the limit raised, by trimming diagnostic message tails in `io/` (PNG scale/size/decode, date length, JSON `schemaVersion`; the CSV unknown-column list was kept), by routing the `fill`/`stroke` bake gate through `isValidBackground` (one color grammar instead of three regexes) and by one shared `assertValidBackground`. The review fixes (host `--fg-bg` typo gate via `CSS.supports`, space-form accepted for explicit backgrounds, Canvas-mode `exportSvg` validating before the throwaway build) are paid for by those levers: kitchen sink ends at 24424 / 24576 (152 B), `+ withIo` at 12914. The Canvas-mode PNG path resolves the ground inside the lazy `export-canvas-png` chunk, which no fixture measures.

   The 2026-10 sticky-header pass (the pinned SVG date axis) came out **net negative** against the
   base it was measured on (master after the export-background change, bytes gzip): `+ withRender`
   14870 → 14795 (-75), `+ withRender + withInteraction` 19524 → 19458 (-66), `+ withRender +
   withViewport` 15793 → 15681 (-112), `+ withRender + withEditHooks` 16227 → 16157 (-70), kitchen sink
   24424 → 24360 (-64); hello world, `+ withIo` and `+ withConflicts` +0. The feature itself costs
   bytes (a sticky `aria-hidden` replica of the header, today rule and label divider cloned per render,
   a `float: inline-start` so it adds no in-flow height, a `clip-path`, a `scroll-padding-top`
   save/restore) but it was paid for by code levers in the same change: one merged
   `applyViewportOptions`, an `el()`/`setAttrs()` builder pair for the SVG constructors, the dead
   reduced-motion focus-ring rule, and the Canvas-parity viewport math (the `bodyTop` branches are
   gone). Headroom therefore went **up**: kitchen sink 152 → 216 B, `with-edit-hooks` 157 → 227 B;
   tightest overall is still `+ withConflicts` at 643 B. (An earlier draft of this paragraph compared
   against the pre-#104/#106 numbers 14196 / 15549 / 23711 and wrongly called the pass a net spend;
   those "before" values predate two other changes that consumed bytes.) Do not read the headroom as
   free: the next renderer feature still has to find its bytes.

   The 2026-10 pinch-zoom pass (`withResponsive()`'s two-finger recognizer) moved ONLY that row:
   20290 -> 20875 B (+585 B, ceiling was +600 B), headroom 629 B; every other fixture is +0 B, and
   it is inside `responsive/mixin.ts` precisely so they stay so. The `gesturestart` iOS fallback
   (+60-80 B) was deliberately not added; it is applied only if the manual iOS check in
   `RELEASING.md` shows page zoom leaking onto the chart.

   The 2026-10 headroom pass 2 ran ahead of four queued features (keyboard focus scroll, Canvas drag,
   the sticky label column, RTL) that together want ~470 B on the kitchen sink, which sat at 190 B of
   headroom. Nothing was raised; bytes were stripped, again with zero behavior change (exported SVG
   byte-identical, zero visual diffs, every test-asserted message substring kept). Gzip bytes, measured
   with `pnpm size`, kitchen sink / `+ withRender + withInteraction` / `+ withRender + withEditHooks`:
   24386 -> 23854 (-532), 19479 -> 19068 (-411), 16177 -> 15994 (-183); hello world 7679 -> 7523 (-156);
   the other fixtures lost 171-235 B, and `+ withResponsive` is 20875 -> 20458 (-417) against master with
   pinch zoom (it was 20290 before pinch). Headroom is now 722 B (kitchen sink), 900 B (`+ withInteraction`)
   and 390 B (`+ withEditHooks`, the tightest; `+ withConflicts` has 814 B). The levers, and what each taught:
   (1) **Long property names that cross module boundaries were the biggest single lever, ~-230 B on the
   kitchen sink.** A minifier cannot rename a property, and gzip charges a name's full length at its first
   occurrence plus ~3 B per reference, so `dependencyStore`, `getMountGeneration` or `expandWithDescendants`
   repeated across the base class and every mixin cost real bytes. The internal `GanttInternal` /
   `MountState` / `InteractionDisposers` members (`tasks`, `deps`, `fold`, `alive`, `mountOf`, ...) and the
   internal pointer-drag recognizer/context/state members (`claim`, `move`, `commit`, `rec`, `grp`, `ts`,
   ...) now have terse names, renamed with the TypeScript language service so every reference moved
   together (-155 B then -76 B on the kitchen sink; the `GanttInternal` half is also -89 B on hello world, the
   pointer-drag half is not in it). Only surfaces that are
   not exported from a package entry were renamed; public option/handle/type member names are untouched.
   (2) **gzip makes repeated text almost free, so only de-duplicating DIFFERENT-looking code or removing
   unique tokens pays.** Four near-identical lever candidates measured as noise or a loss (a `line()` builder
   for the four SVG rules +15 B, a `renderRows` closure +14..+19 B, an `el()` style `cssText` -13..+3 B,
   hoisting the repeated `getTasks`/`getCollapsedIds`/zoom lambdas in `interaction/mixin.ts` +2 B) and were
   dropped, as were a merged forward/backward `walkWorkingHours` (+26 B) and a collapsed `selection.ts` click
   branch (+27 B even though raw bytes fell 125 B). What won: one `applyOp` for undo+redo (-23..-33 B on every
   fixture), one `indexGraph` shared by CPM and cascade (-16..-22 B), the drag chrome (class + cursor) owned
   by the pointer-drag coordinator instead of repeated in three recognizers plus `findGroupTask` and
   `readClientScale` shared by the three hit-tests (-92 B on `+ withInteraction`), the CSV and JSON import
   `optional()` / `arrayWithin()` helpers (-68 B on `+ withIo`), a `setFocus` pair and a hoisted modifier
   check in keyboard-nav (-29 B), one `#replaceCollapsed` (-2..-5 B), and four diagnostic tails nothing
   asserts on (-53 B on hello world). (3) The measurement noise floor is about +-20 B per change (gzip
   re-bins), so any lever under ~25 B is judged on the cumulative number, not alone. (4) Not done, on
   purpose: merging `SelectionStore`/`CollapseStore` (would change the public class shape), merging the RGB
   and HSL color regexes (security-critical whitelist, auditability beats ~15 B), and collapsing
   `topologicalSort`'s successor map into the callers' (changes the cascade `shifts` order).

   The keyboard-focus-scroll fix (ArrowUp/ArrowDown scroll the SVG chart so the focused row stays below
   the pinned header) was the first of those four features to land, measured against pass 2's master:
   kitchen sink 23854 -> 23948 (+94 B, headroom 722 -> 628 B), `+ withRender + withInteraction` 19068 ->
   19157 (+89 B, 811 B left), `+ withResponsive` 20458 -> 20543 (+85 B, 961 B left); the seven fixtures
   without interaction +0 B. About 14 B of it is the live `density` getter (`setDensity()` and
   `withResponsive` change the painted row height after mount, and the reveal scrolls by row geometry).

   The 2026-10 SVG render-perf pass (one repaint per effect run, critical path + rollup memoized by store revision, aria-label date memo, `computeGridColumns` holiday hoist, a per-array holiday-set cache in the compute layer) cost about +55 B on `+ withRender` and +60 B on every fixture holding the compute layer (the holiday cache), measured against master as of #113: hello world 7584, `+ withIo` 12744, `+ withRender` 14755, `+ withRender + withInteraction` 19275, kitchen sink 24069 (507 B of headroom), `+ withConflicts` 9488, `+ withRender + withEditHooks` 16094 (290 B). The render-side additions were partly paid for inside the same change (single `update(input, options?)`, the `cssEscapeAttr` helper replaced by an attribute scan, two warning tails trimmed). A row-level patch path for selection (+100-260 B est.) was deliberately not built.

   Canvas-mode drag (2026-10, rebased onto headroom pass 2 and the SVG render-perf pass) costs the kitchen sink about +45 B (now 24109, 467 B of headroom), `+ withRender + withInteraction` about +40 B (19317), `+ withInteraction + withResponsive` about +55 B (20721) and `+ withEditHooks` about +25 B (16115); the other fixtures moved +0 B. The heavy code (hit-test, recognizers, overlay) sits in the lazy Canvas chunk (~8.5 -> ~11.3 KiB gzip, in no budget). Helper extraction (`badPoint`/`tryCapture`), a window-listener loop and a cached `pointerEventTarget` local each COST bytes under gzip and were not kept.

The 2026-10 sticky-label-column pass (the SVG label column pinned on horizontal scroll, plus the
`div.fg-timeline__layer` wrapper that fixes flex/grid hosts) was paid for by levers, not a limit
(gzip bytes, against master acaf680): `+ withRender` 14902 -> 14865 after levers, kitchen sink
24109 -> 24231, `with-edit-hooks` 16115 -> 16219, hello world / `+ withIo` / `+ withConflicts`
+0 B. Levers that won: the two ARIA/size `setAttrs` calls merged, `renderRowToggle` and
`renderLinkHandle` folded into their one caller, the three `<style>` elements merged into one, the
`DEFAULT_*` single-use constants inlined, `appendChild` -> `append` (gzip likes the repeat), `svg.replaceChildren()` for the clear loop (-16 B, the lever that paid for scoping the hide rule to `.fg-timeline__layer>`), a shared `pin()` builder for the three layers. A shared
`line()` builder was measured and REJECTED (+30 B). Headroom is now kitchen sink 345 B,
`+ withRender` 495 B and `with-edit-hooks` 165 B, the tightest and right at the 150 B warning line:
the next renderer feature has to find its own bytes.

Run `pnpm size` from `packages/core` (or `pnpm size` at the root via turbo) to re-measure; the numbers above are its output, converted from its decimal-kB report to KiB. **It needs Node >= 22.19** — that is `size-limit` 14's own declared `engines.node` (`^22.19.0 || ^24.5.0 || >=26.0.0`), and the floor is enforced by the root `engines.node` so a permitted Node cannot be one the repo fails on. Before 14 the practical floor was 22.18, because `size-limit` calls `fs.glob` with `withFileTypes` (added in Node 22.2) and on an older 22.x it dies with an opaque `TypeError: i.isFile is not a function` that looks like a repo misconfiguration but is not. `.nvmrc` pins an exact version for this reason; CI reads it via `node-version-file`.
6. **Tier-gate correctly** — Pro (resource/baseline/MSProject), Cloud (multiplayer/AI). Don't cram Pro/Cloud code into `core`.
7. **Every new feature ships with tests.** See `.claude/rules/testing.md`.
8. **Security**: validate every external input (file import, share link, API). See `.claude/rules/security.md`.
9. **Language**: chat with the user in **Vietnamese**; but **all code, comments, identifiers, docs, commit messages, and PRs are written in English** (professional international OSS standard). Don't back-translate old files unless asked.

## Locked tech stack
TypeScript 6 strict · ESM-first (tsup dual) · ES2022 · pnpm workspaces + turbo · changesets ·
vitest (unit) · playwright (e2e/visual) · @testing-library (wrappers) · Temporal polyfill ·
Yjs (Pro/Cloud) · Hono + Postgres + Drizzle + Better-Auth (Cloud) · Stripe · Vocs (docs).

## Repo layout
`packages/*` (core, react, vue, svelte, angular, ai, msproject, cloud-sdk) ·
`examples/*` · `apps/*` (docs, landing, playground) · `tooling/*` · `tests/*` (e2e/visual/a11y/performance) · `.changeset/`.

## Common commands (after setup)
```bash
pnpm install
pnpm -r build          # build all packages via turbo
pnpm -r test           # unit tests (vitest)
pnpm test:e2e          # playwright
pnpm lint && pnpm typecheck
pnpm changeset         # create a changeset before releasing
```

## Current stage
**Wave 1 (Core MIT MVP) — shipped and published.** The `@fluxgantt` org's first release went to
npm on 2026-09-24 (`core@0.2.0`, `react@0.1.1`, `vue@0.1.1`); `core@0.2.1` / `react@0.1.2` /
`vue@0.1.2` followed the same day. Check the registry rather than this line for what is current —
releases are routine now and it will go stale.

The whole priority list shipped: reactive TaskStore, SVG + Canvas renderers,
drag, dependencies, critical path, React/Vue wrappers, export, docs. Also landed beyond it: the
facade/mixin split, theming, i18n scaffold, responsive/touch, and the size budgets.

Releases are now routine: land a changeset, and merging the bot's "Version Packages" PR publishes.
`docs-deploy.yml` exists but the docs site is **not deployed yet** — its first run is a
`workflow_dispatch` and remains the owner's explicit go/no-go, so every `thai-pc.github.io/fluxgantt`
link in the repo (including the `homepage` field of all three published packages) is currently
dead. See `RELEASING.md`. No Pro/Cloud yet unless explicitly requested.

Consequence for anything you write here: the published surface is now a **compatibility
commitment**. A change to an exported type, an event name or a subpath export needs a changeset
and a reason, not just a passing test.
