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
5. **Tree-shakable + bundle budget** — the `Gantt` facade is a base class plus opt-in mixins on their own subpath exports (`@fluxgantt/core/io`, `/render`, `/interaction`, ...), because class prototype methods never tree-shake. Non-core features are plugins. Fixtures live in `packages/core/size-limit/` and are measured as ESM gzip by `size-limit`.

   **Policy (re-based 2026-11, owner-approved).** The budget protects the order of magnitude (we are 4-6x smaller than the nearest competitors), not every hundred bytes. Byte-level limits on every fixture had begun to block performance fixes and push architecture toward monkey-patching.
   - **Three HARD gates fail CI** (`.size-limit.json`, `pnpm --filter @fluxgantt/core size:hard`): hello world, `+ withRender + withInteraction`, and the kitchen sink. Each limit is ~10% over the size measured at the re-base, rounded up to the next 0.25 KiB.
   - **Eight SOFT fixtures are report-only** (`.size-limit.soft.json`, `size:soft`): measured and printed on every CI run, never failing it. Their old limits stay as reference budgets. The report warns (GitHub `::warning`) when a soft fixture is over its reference limit or grew more than 5% against `size-limit/baselines.json` (the master sizes at the re-base; refresh with `pnpm --filter @fluxgantt/core size:baseline` when a change is deliberate).
   - `pnpm size` (from `packages/core`, or the root via turbo) prints all eleven fixtures and exits non-zero only if a hard gate fails. `size:headroom` (non-fatal CI step) warns when a hard gate has less than 25% of its allotted headroom (limit minus re-base size) left.

   | Fixture | Tier | Measured (B / KiB) | Limit |
   |---|---|---|---|
   | `createGantt()` only (hello world) | **hard** | 7645 / 7.47 | 8.25 KiB |
   | `+ withRender + withInteraction` | **hard** | 19770 / 19.31 | 21.25 KiB |
   | kitchen sink (everything) | **hard** | 24565 / 23.99 | 26.25 KiB |
   | `+ withIo` | soft | 12793 / 12.49 | 14 KiB |
   | `+ withRender` | soft | 14976 / 14.62 | 15 KiB |
   | `+ withRender + withTheme` | soft | 15670 / 15.30 | 16 KiB |
   | `+ withRender + withInteraction + withResponsive` | soft | 21228 / 20.73 | 21 KiB |
   | `+ withRender + withViewport` | soft | 15904 / 15.53 | 16 KiB |
   | `+ withConflicts` (headless) | soft | 9574 / 9.35 | 10 KiB |
   | `+ withRender + withEditHooks` | soft | 16347 / 15.96 | 16 KiB |
   | `+ withRender + withRtl` | soft | 15431 / 15.07 | 15.5 KiB |

   The tightest soft fixtures at the re-base are `+ withEditHooks` (190 B under its reference limit) and `+ withResponsive` (429 B); they will warn first.

   **Exemption rule.** A correctness, security, accessibility or performance fix MAY consume hard-gate headroom; state the byte cost in the PR. New features must still find their own bytes: "change the shape, not the budget" stays the default for features (see `.claude/rules/size-history.md` for which levers win under gzip). **Raising a hard limit again requires an explicit owner decision recorded here**, with the date and reason. Do not raise a limit to fit a feature.

   Decision log: 2026-11 re-base: 9 / 19.5 / 24 KiB -> 8.25 / 21.25 / 26.25 KiB (hello world was tightened, the other two loosened). Arithmetic: 7526 B x 1.10 = 8279 B -> 8.25 KiB (8448 B, +12.2%); 19616 B x 1.10 = 21578 B -> 21.25 KiB (21760 B, +10.9%); 24421 B x 1.10 = 26863 B -> 26.25 KiB (26880 B, +10.1%).

   **Headline sizes EXCLUDE the Temporal polyfill.** Core reads `globalThis.Temporal` and bundles no polyfill. Runtimes without native Temporal need `@js-temporal/polyfill` (peer dependency, optional at runtime): Node 22/24 and older browsers (checked 2026-11-12: Playwright Chromium 153, Firefox 155 and WebKit 26.6 all expose `Temporal` natively, Node 24.21 does not; re-check before each release). The polyfill is ~45.8 KiB gzip (46,863 B: `@js-temporal/polyfill@0.5.1` plus its `jsbi` dependency, esbuild-minified ESM, gzip -9), so on such a runtime the "7.35 KiB" hello world is ~53 KiB in total, and an editable chart ~65 KiB. Any size claim in the README, docs or launch copy must say "excluding the Temporal polyfill" and give that figure. The competitor figures (dhtmlx, Frappe) do not need a polyfill.

   History, the measured lever passes and the lessons (including the template-literal CSS trap) are in `.claude/rules/size-history.md`; read it before trying to shave bytes.
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
