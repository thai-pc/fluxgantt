# FluxGantt — AI Context (CLAUDE.md)

> A TypeScript-first, MIT-licensed Gantt chart library. Headless engine decoupled from rendering.
> Source spec: `docs/fluxgantt-spec.md` (living document, v0.1.0).

This file is the context entry point for AI. Details are split into rules under `.claude/rules/`.
**Before coding, read the relevant rule.**

## Rules (read as needed)
- @.claude/rules/project-overview.md — product, tiers, monetization, roadmap
- @.claude/rules/architecture.md — layered architecture, design principles, type system
- @.claude/rules/coding-conventions.md — naming, file layout, API style
- @.claude/rules/testing.md — testing strategy (vitest, playwright, fast-check)
- @.claude/rules/security.md — **MUST read** before touching IO/auth/cloud/AI

## Stability policy
The API report is the lock and the TSDoc tag decides the tier (stable, `@beta`, `@deprecated`): read
[`STABILITY.md`](https://github.com/thai-pc/fluxgantt/blob/master/STABILITY.md) before changing an exported symbol. A report change needs a minor changeset.

## Golden rules (summary, do not violate)
1. **Headless first** — core runs without a DOM (Node/Workers/tests). No DOM API imports in `store/`, `compute/`, or pure-data `io`.
2. **Framework-agnostic core** — `@fluxgantt/core` must NOT import `react`/`vue`/`svelte`. Framework opinions live only in wrappers.
3. **Date = Temporal API**, never native `Date` for any computation (timezone/DST). Native `Date` only at the I/O boundary.
4. **TypeScript strict** — no implicit `any`, branded IDs (`TaskId`, `ResourceId`...) never mixed.
5. **Tree-shakable + bundle budget** — the `Gantt` facade is a base class plus opt-in mixins on their own subpath exports (`@fluxgantt/core/io`, `/render`, `/interaction`, ...), because class prototype methods never tree-shake. Non-core features are plugins. Fixtures live in `packages/core/size-limit/` and are measured as ESM gzip by `size-limit`.

   **Policy (re-based 2026-11, owner-approved).** The budget protects the order of magnitude (we are 4-6x smaller than the nearest competitors), not every hundred bytes. Byte-level limits on every fixture had begun to block performance fixes and push architecture toward monkey-patching.
   - **Four HARD gates fail CI** (`.size-limit.json`, `pnpm --filter @fluxgantt/core size:hard`): hello world, `+ withRender + withInteraction`, the kitchen sink, and everything composed (`size-limit/everything.js`: every opt-in mixin, incl. grid and grid editing once they ship). Each limit is ~10% over the size measured at the re-base, rounded up to the next 0.25 KiB.
   - **Nine SOFT fixtures are report-only** (`.size-limit.soft.json`, `size:soft`): measured and printed on every CI run, never failing it. Their old limits stay as reference budgets. The report warns (GitHub `::warning`) when a soft fixture is over its reference limit or grew more than 5% against `size-limit/baselines.json` (the master sizes at the re-base; refresh with `pnpm --filter @fluxgantt/core size:baseline` when a change is deliberate).
   - `pnpm size` (from `packages/core`, or the root via turbo) prints all thirteen fixtures and exits non-zero only if a hard gate fails. `size:headroom` (non-fatal CI step) warns when a hard gate has less than 25% of its allotted headroom (limit minus re-base size) left.

   | Fixture | Tier | Measured (B / KiB) | Limit |
   |---|---|---|---|
   | `createGantt()` only (hello world) | **hard** | 8380 / 8.18 | 8.25 KiB |
   | `+ withRender + withInteraction` | **hard** | 21749 / 21.24 | 21.25 KiB |
   | kitchen sink (io + render + interaction) | **hard** | 26537 / 25.92 | 26.25 KiB |
   | everything composed (every mixin, `size-limit/everything.js`) | **hard (4th)** | 37274 / 36.40 | 40.25 KiB |
   | `+ withIo` | soft | 13525 / 13.21 | 14 KiB |
   | `+ withRender` | soft | 16048 / 15.67 | 15 KiB |
   | `+ withRender + withTheme` | soft | 16742 / 16.35 | 16 KiB |
   | `+ withRender + withInteraction + withResponsive` | soft | 23256 / 22.71 | 21 KiB |
   | `+ withRender + withViewport` | soft | 16967 / 16.57 | 16 KiB |
   | `+ withConflicts` (headless) | soft | 10322 / 10.08 | 10 KiB |
   | `+ withRender + withEditHooks` | soft | 17397 / 16.99 | 16 KiB |
   | `+ withRender + withRtl` | soft | 16542 / 16.15 | 15.5 KiB |
   | `+ withRender + withGrid` | soft | 20555 / 20.07 | 20 KiB |

   Table re-measured 2026-11-13 after the grid-columns seam PR (G0: multi-consumer `handle.paintHooks`, `fixedLabelWidth`, `internal.announce`, the inert Canvas `grid` option and the `part: 'cell'` types). Against master 5440bf3 (gzip bytes): hello world +0 (8380, 68 B left), `+ withRender + withInteraction` 21655 -> 21749 (+94, 11 B left), kitchen sink 26432 -> 26535 (+103, 345 B left); soft fixtures +0 (`+ withIo`, `+ withConflicts`) .. +128 (`+ withRtl`). A feature seam, NOT an exemption claim; it is over the spec's +90 B per hard fixture by 4 / 13 B because the review asked for composition-time registration (hooks see the mount paint, `withRtl` always last, isolated dispatch, a writer that survives unmount), which cost about +14 / +21 B on top of the first cut. The new fourth gate is measured, not compared.

   Table re-measured 2026-11-13 after the grid columns PR (G1: `@fluxgantt/core/grid`, the SVG painter, `exportGridCsv`). Against master 88f4e8c (gzip bytes): hello world +0 (8380, 68 B left), `+ withRender + withInteraction` +0 (21749, 11 B left), kitchen sink 26535 -> 26537 (+2, from `writeRow` becoming an exported symbol of `io/csv.ts`; 343 B left); every other existing fixture +0 except `+ withIo` -3; the new `+ withRender + withGrid` soft fixture is 20555 B (75 B OVER its 20 KiB reference, a soft warning: the review fixes cost +401 B). The everything gate went 32877 -> 37274 (+4397 B) because it now composes `withGrid`, and is re-based under the build-out window (see the decision log).

   Measured after the DependencyStore index PR (`perf/dependency-indexes`) on top of the TaskStore index PR (`perf/store-indexes`) on top of the keyboard move/resize/link PR. Together the two store PRs cost +429 / +444 / +416 B on the three hard fixtures (+189..+439 B on the soft ones), spent under the exemption rule: hello world 7830 -> 8259, `+ withInteraction` 20840 -> 21284, kitchen sink 25629 -> 26045. Soft fixtures over their reference limit (warnings only, as measured 2026-11-12 on the focus-frame branch): `+ withRender` (15957 vs 15360 B), `+ withTheme` (16656 vs 16384 B), `+ withResponsive` (23123 vs 21504 B), `+ withViewport` (16867 vs 16384 B), `+ withConflicts` (10322 vs 10240 B), `+ withEditHooks` (17306 vs 16384 B) and `+ withRtl` (16402 vs 15872 B); mostly master drift, the frame adds +248..+272 to the render ones.

   Table re-measured 2026-11-12 after the row focus frame PR (`fix/focus-visible-offscreen`, WCAG 2.4.7 / 2.4.11, renderer-only, spent under the exemption rule): hello world +0 (8380, 68 B left), `+ withRender + withInteraction` 21396 -> 21655 (+259, 105 B left), kitchen sink 26164 -> 26432 (+268, 448 B left); soft fixtures +0..+283 (review round: focus-follow listener, own column rect, forced-colors rules). Master had drifted from the previous paragraph's figures (the `task:updated` work, among others); the table now shows master + this PR.

   **Exemption rule.** A correctness, security, accessibility or performance fix MAY consume hard-gate headroom; state the byte cost in the PR. New features must still find their own bytes: "change the shape, not the budget" stays the default for features (see `.claude/rules/size-history.md` for which levers win under gzip). **Raising a hard limit again requires an explicit owner decision recorded here**, with the date and reason. Do not raise a limit to fit a feature.

   Decision log: 2026-11-13 fourth hard gate (owner decision): added "Everything composed (all mixins incl. grid + grid editing)" (`size-limit/everything.js`), which composes every opt-in mixin that exists (io, render, interaction, theme, viewport, conflicts, edit-hooks, rtl, responsive; `withGrid` and `withGridEditing` join in their own PRs). The kitchen sink is unchanged and stays WITHOUT the opt-in mixins. Limit = measured x 1.10 rounded up to the next 0.25 KiB (256 B): at G0, 32877 B x 1.10 = 36165 B -> 35.5 KiB (36352 B, +10.6%). The gate is created before any grid code merges so the grid never lands unguarded. Build-out window: each grid PR that adds code to the fixture (G1 columns, G3 resize, G4 keyboard, G6 editing) re-bases the limit and the `size-limit/baselines.json` value with the same formula against its own measurement, arithmetic in the PR body, capped at 44 KiB; the limit is frozen once G6 merges, after which raising it needs an explicit owner decision recorded here. The grid soft fixtures are report-only. G1 re-base (2026-11-13): `withGrid` joined `everything.js`, measured 37274 B; 37274 B x 1.10 = 41001 B -> 40.25 KiB (41216 B, +10.6%), under the 44 KiB cap; baseline 32877 -> 37274. Remaining window: G3 (resize), G4 (keyboard), G6 (editing).

   Decision log: 2026-11 re-base: 9 / 19.5 / 24 KiB -> 8.25 / 21.25 / 26.25 KiB (hello world was tightened, the other two loosened). Arithmetic: 7526 B x 1.10 = 8279 B -> 8.25 KiB (8448 B, +12.2%); 19616 B x 1.10 = 21578 B -> 21.25 KiB (21760 B, +10.9%); 24421 B x 1.10 = 26863 B -> 26.25 KiB (26880 B, +10.1%).

   **Headline sizes EXCLUDE the Temporal polyfill.** Core reads `globalThis.Temporal` and bundles no polyfill. Runtimes without native Temporal need `@js-temporal/polyfill` (peer dependency, optional at runtime): Node 22/24 and older browsers (checked 2026-11-12: Playwright Chromium 153, Firefox 155 and WebKit 26.6 all expose `Temporal` natively, Node 24.21 does not; re-check before each release). The polyfill is ~45.8 KiB gzip (46,863 B: `@js-temporal/polyfill@0.5.1` plus its `jsbi` dependency, esbuild-minified ESM, gzip -9), so on such a runtime the "7.35 KiB" hello world is ~53 KiB in total, and an editable chart ~65 KiB. Any size claim in the README, docs or launch copy must say "excluding the Temporal polyfill" and give that figure. The competitor figures (dhtmlx, Frappe) do not need a polyfill.

   History, the measured lever passes and the lessons (including the template-literal CSS trap) are in `.claude/rules/size-history.md`; read it before trying to shave bytes.
6. **Tier-gate correctly** — MIT core keeps critical path, all wrappers (React/Vue/Svelte/Angular) and basic/custom grid columns. Pro (perpetual, planned, not yet on sale) = resources/leveling, baselines, constraints, MS Project XML, PDF branding. No watermark. Don't cram Pro code into `core`. The hosted Cloud tier (multiplayer/AI auto-schedule) is **not committed** since the 2026-11 strategy revision — see `.claude/rules/project-overview.md`.
7. **Every new feature ships with tests.** See `.claude/rules/testing.md`.
8. **Security**: validate every external input (file import, share link, API). See `.claude/rules/security.md`.
9. **Language**: chat with the user in **Vietnamese**; but **all code, comments, identifiers, docs, commit messages, and PRs are written in English** (professional international OSS standard). Don't back-translate old files unless asked.

## Locked tech stack
TypeScript 6 strict · ESM-first (tsup dual) · ES2022 · pnpm workspaces + turbo · changesets ·
vitest (unit) · playwright (e2e/visual) · @testing-library (wrappers) · Temporal polyfill ·
Stripe (Pro checkout) · Vocs (docs). Yjs only for the on-demand sync adapter. The former Cloud backend stack (Hono + Postgres + Drizzle + Better-Auth, Stripe subscriptions) is exploratory, not locked (2026-11 strategy revision).

## Repo layout
`packages/*` (core, react, vue, svelte, angular, ai, msproject, cloud-sdk) ·
`examples/*` · `apps/*` (landing, playground placeholders) · `docs/` (spec, launch drafts) · `tooling/*` · `tests/*` (e2e/visual/a11y/performance) · `.changeset/`.

## Common commands (after setup)
```bash
pnpm install
pnpm -r build          # build all packages via turbo
pnpm -r test           # unit tests (vitest)
pnpm test:e2e          # playwright
pnpm lint && pnpm typecheck
pnpm changeset         # create a changeset before releasing
pnpm api:update        # after a build: regenerate packages/*/etc/*.api.md (public API lock; `pnpm api:check` verifies)
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
The docs site is **its own repository** (split out of `apps/docs` with history, 2026-11) and is
hosted on **Cloudflare Pages at `https://fluxgantt.thai-pc.com` once the owner connects the
project** (Git integration on that repo: push to its `main` deploys, PRs get previews). A feature
PR that changes documented behaviour needs a matching docs-repo PR. Until the site is live
every link to it in the repo (including the `homepage` field of all three published packages) is
dead. See `RELEASING.md` → Docs site. No Pro yet unless explicitly requested.

**2026-11 strategy revision** (owner-approved, from `.claude/work/audit-architecture-fable.md` S1/S3/S4):
the MIT-tier rivals are DHTMLX Gantt 10 Community, SVAR Gantt and Bryntum 8 Community, not Frappe;
Pro is planned as a ~$600–800/dev perpetual licence that allows SaaS use with no OEM surcharge (not
on sale); the hosted Cloud tier is off the committed roadmap, replaced by an MIT MCP server +
`llms.txt` and a Yjs sync adapter built only on pre-sold demand. Details in
`.claude/rules/project-overview.md`.

Consequence for anything you write here: the published surface is now a **compatibility
commitment**. A change to an exported type, an event name or a subpath export needs a changeset
and a reason, not just a passing test.
