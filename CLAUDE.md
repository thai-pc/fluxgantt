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
5. **Tree-shakable + bundle budget** — core "hello world" < 15kb gzip, full core < 34kb gzip (raised from 30kb→32kb after keyboard-nav/a11y landed, then 32kb→34kb after undo/redo landed — both are Core-wide editor baseline UX, not plugin candidates). Non-core features are plugins.
6. **Tier-gate correctly** — Pro (resource/baseline/MSProject), Cloud (multiplayer/AI). Don't cram Pro/Cloud code into `core`.
7. **Every new feature ships with tests.** See `.claude/rules/testing.md`.
8. **Security**: validate every external input (file import, share link, API). See `.claude/rules/security.md`.
9. **Language**: chat with the user in **Vietnamese**; but **all code, comments, identifiers, docs, commit messages, and PRs are written in English** (professional international OSS standard). Don't back-translate old files unless asked.

## Locked tech stack
TypeScript 5.4+ strict · ESM-first (tsup dual) · ES2022 · pnpm workspaces + turbo · changesets ·
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
Pre-build / Wave 1 (Core MIT MVP). Priority: reactive TaskStore → SVG renderer → drag → dependencies → critical path → React/Vue wrapper → export → docs. No Pro/Cloud yet unless explicitly requested.
