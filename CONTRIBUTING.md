# Contributing to FluxGantt

Thanks for your interest! This document summarizes the workflow. Detailed conventions live
in [`.claude/rules/`](./.claude/rules).

## Setup

```bash
pnpm install
pnpm build
pnpm test
```

Node >= 20 (22 recommended, see `.nvmrc`), pnpm 10+.

## Non-negotiable principles

- **Headless first** — code in `core/src/{store,compute}` must not import DOM/framework APIs.
- **Framework-agnostic core** — `@fluxgantt/core` must not import react/vue/svelte.
- **Temporal API** for all date/time math, never native `Date`.
- **TypeScript strict**, branded IDs, no `any`.
- **Tree-shakable** — no top-level side effects; respect the bundle budget (core <30kb, hello-world <15kb gzip).
- **Every new feature ships with tests** (see `.claude/rules/testing.md`).
- **Security** — validate every external input (see `.claude/rules/security.md`).
- **Language** — chat/discussion may be in Vietnamese, but all code, comments, docs, commit messages, and PRs are written in English.

## PR workflow

1. Branch off `main`.
2. Write code + tests. Run `pnpm lint && pnpm typecheck && pnpm test`.
3. `pnpm changeset` — describe the change (version bump + changelog are automated). Changes
   scoped entirely to `apps/*` or `examples/*` (docs site, example apps) need **no changeset** —
   those packages are `"private": true` and never published.
4. Open a PR. CI must be green (lint, typecheck, test, e2e, size-limit).

## Code style

- Files kebab-case (`task-store.ts`), components PascalCase (`FluxGantt.tsx`).
- Methods: verb + noun camelCase. Events: past-tense `noun:verb`. Types: PascalCase, no `I` prefix.
- CSS: BEM with the `fg-` prefix, custom properties `--fg-*`.
- Prettier + ESLint (shared config in `tooling/`).

## Reporting security issues

Do not open a public issue for a security vulnerability. Email: security@fluxgantt.dev.
