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
   | `createGantt()` only (hello world) | 7.71 KiB | 9 KiB |
   | `+ withIo` | 12.67 KiB | 14 KiB |
   | `+ withRender` | 14.74 KiB | 15 KiB |
   | `+ withRender + withInteraction` | 19.17 KiB | 19.5 KiB |
   | `+ withRender + withTheme` | 15.26 KiB | 16 KiB |
   | `+ withRender + withInteraction + withResponsive` | 19.91 KiB | 21 KiB |
   | kitchen sink (everything = the pre-split facade) | 23.82 KiB | 24 KiB |

   Hello world went 22.3 KiB → 7.71 KiB and the fully-composed instance 34.9 KiB → 23.82 KiB (the old "full core" check measured `dist/index.js` as a plain file, which code-splitting has since hollowed out; the kitchen-sink fixture replaces it). Non-core features are plugins.

   The `withRender + withInteraction` budget was raised 19 → 19.5 KiB once, for the i18n scaffold (`GanttConfig.messages`), after the levers this rule prefers were measured and came up ~67 B short: merging the two renderer-option builders recovered only 13 B, and ~68 B of the cost is the irreducible price of threading host messages through both renderers. Justified as WCAG-adjacent — the strings in question are accessible names. Treat that as the exception it was, not a precedent: the rule is still change the shape, not the budget.

   The 2026-09 responsive/touch pass is what that rule looks like when it is followed. Its first
   measurement blew THREE budgets at once, because the coarse-pointer CSS — and the long comment
   justifying it — sat inside a template literal in `svg-renderer.ts`, and **every character inside
   those CSS template literals is shipped bytes, comments included**. The fix was not a budget
   bump: the block moved into `withResponsive()`'s own injected stylesheet on the new
   `@fluxgantt/core/responsive` subpath, which left all six pre-existing fixtures at **+0 B** and
   put the 783 B where only charts that ask for it pay. Remember the template-literal trap the next
   time a renderer needs a CSS rule.

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
facade/mixin split, theming, i18n scaffold, responsive/touch, and the seven size budgets.

Releases are now routine: land a changeset, and merging the bot's "Version Packages" PR publishes.
`docs-deploy.yml` exists but the docs site is **not deployed yet** — its first run is a
`workflow_dispatch` and remains the owner's explicit go/no-go, so every `thai-pc.github.io/fluxgantt`
link in the repo (including the `homepage` field of all three published packages) is currently
dead. See `RELEASING.md`. No Pro/Cloud yet unless explicitly requested.

Consequence for anything you write here: the published surface is now a **compatibility
commitment**. A change to an exported type, an event name or a subpath export needs a changeset
and a reason, not just a passing test.
