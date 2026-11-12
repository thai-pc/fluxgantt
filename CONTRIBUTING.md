# Contributing to FluxGantt

Thanks for your interest! This document summarizes the workflow. Detailed conventions live
in [`.claude/rules/`](./.claude/rules).

## Setup

```bash
pnpm install
pnpm build
pnpm test
```

Node >= 22.19 (see `.nvmrc` for the exact pinned version), pnpm 10+.

## Non-negotiable principles

- **Headless first** — code in `core/src/{store,compute}` must not import DOM/framework APIs.
- **Framework-agnostic core** — `@fluxgantt/core` must not import react/vue/svelte.
- **Temporal API** for all date/time math, never native `Date`.
- **TypeScript strict**, branded IDs, no `any`.
- **Tree-shakable** — no top-level side effects; respect the per-capability bundle budgets.
  There is no single "core" budget any more: the facade is a base plus opt-in mixins on their
  own subpath exports, each measured against its own fixture. Three are hard CI gates (`createGantt()` alone
  8.25 KiB gzip, an editable chart 21.25 KiB, the kitchen sink 26.25 KiB); the other eight only
  warn. Sizes exclude the Temporal polyfill. Run `pnpm size` for the current numbers; the policy and
  full table are in CLAUDE.md golden rule 5. The old `core <36kb` / `hello-world <22kb` pair was retired with
  the split — it measured `dist/index.js` as a plain file, which code-splitting has hollowed out.
- **Every new feature ships with tests** (see `.claude/rules/testing.md`).
- **Security** — validate every external input (see `.claude/rules/security.md`).
- **Language** — chat/discussion may be in Vietnamese, but all code, comments, docs, commit messages, and PRs are written in English.

## PR workflow

1. Branch off `master`.
2. Write code + tests. Run `pnpm lint && pnpm typecheck && pnpm test`.
3. `pnpm changeset` — describe the change (version bump + changelog are automated). Changes
   scoped entirely to `apps/*`, `examples/*` or `docs/` (example apps, the spec and launch
   drafts) need **no changeset** — none of it is published. The docs **site** is not in this repo
   any more: a change to documented behaviour needs a matching PR in the docs-site repository
   (`RELEASING.md` → Docs site).
   Examples are copied to the `stackblitz` branch at release time by
   `tooling/scripts/build-stackblitz-examples.mjs`. An example may import only **published**
   `@fluxgantt/*` entry points plus packages declared in its own `package.json` (react, vue,
   `@js-temporal/polyfill`, ...), and no relative path outside its folder; otherwise the generated
   copy fails CI. Each entry imports `./temporal.js` first, so the examples also run in browsers
   without native Temporal.
4. Open a PR. CI must be green (lint, typecheck, test, e2e, size-limit, API reports, publish-readiness, and
   the StackBlitz clean-room build of the examples).

Merging a PR never publishes anything. See [`RELEASING.md`](./RELEASING.md) for how a changeset
becomes an npm release.

## Changing the public API

The exported surface of `@fluxgantt/core` (every entry point), `@fluxgantt/react` and
`@fluxgantt/vue` is recorded in committed [API Extractor](https://api-extractor.com/) reports:
`packages/*/etc/*.api.md`, one per entry in each package's `exports` map. CI fails when a report is
stale.

```bash
pnpm api:update   # builds, then regenerates every report; commit the result
pnpm api:check    # what CI runs (needs a fresh build): fails on a stale or missing report
```

Rules when a report changes (enforced on PRs by `pnpm api:changeset`):

- The PR must add (or edit) a changeset that **names the package** with at least a **minor** bump.
  A patch release never changes a report.
- API Extractor derives `// (undocumented)` markers and `// Warning:` lines from doc comments and
  forgotten exports, not from the API, so the changeset gate strips them before comparing. Adding a
  doc comment therefore needs no changeset. (`api:check` still asks you to regenerate the file.)
- If the diff **removes or alters** a declaration line, the changeset body needs a line starting
  `BREAKING:` (stable API) or `Beta:` (experimental API) saying so.
- The gate is a tripwire, not a semver oracle. It cannot tell additive from breaking: adding a
  **required** member to an input type such as `GanttConfig` only adds lines yet breaks every host,
  while widening a union rewrites a line yet breaks nobody. Reviewers decide what is breaking and
  must check that the `BREAKING:` / `Beta:` line is true. A renamed package directory is exempt for
  that one PR (it has no reports at the base).
- The Vue report embeds Vue's own `DefineComponent<...>` generics, so a `vue` or TypeScript
  dependency bump can change `vue.api.md` without any FluxGantt change. Regenerate it and say so in
  the changeset rather than treating it as an API decision.
- Reports are generated from `dist/`, never from a stale build: always go through `pnpm api:update`.
- A new `exports` subpath needs its report committed, or `api:check` fails.
- `pnpm attw` checks the packed packages with
  [`@arethetypeswrong/cli`](https://github.com/arethetypeswrong/arethetypeswrong.github.io) so
  ESM and CommonJS consumers both resolve types (`.d.ts` for `import`, `.d.cts` for `require`).

## Code style

- Files kebab-case (`task-store.ts`), components PascalCase (`FluxGantt.tsx`).
- Methods: verb + noun camelCase. Events: past-tense `noun:verb`. Types: PascalCase, no `I` prefix.
- CSS: BEM with the `fg-` prefix, custom properties `--fg-*`.
- Prettier + ESLint (shared config in `tooling/`).

## Reporting security issues

Do not open a public issue for a security vulnerability. Report it privately through GitHub's
[Private Vulnerability Reporting](https://github.com/thai-pc/fluxgantt/security/advisories/new).
See [`SECURITY.md`](./SECURITY.md) for what is in scope and what to expect.
