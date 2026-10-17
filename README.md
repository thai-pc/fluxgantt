<div align="center">

# FluxGantt

**The Modern MIT-Licensed Gantt Chart Library**

TypeScript-first · headless · framework-agnostic

`Drag tasks. Compute the critical path. Ship MIT.`

[![License: MIT](https://img.shields.io/badge/License-MIT-6366f1.svg)](./LICENSE)

</div>

---

FluxGantt is a TypeScript-first, MIT-licensed Gantt chart library targeting the gap between
expensive commercial offerings (dhtmlx, Bryntum) and weak open-source ones (Frappe Gantt,
jsGantt). Its headless core is fully decoupled from rendering, renders to SVG (Canvas fallback
above 2000 tasks), and does all date/time math with the Temporal API.

> [!NOTE]
> **0.x — the API is still stabilizing pre-1.0.** Published and installable, but a minor bump
> may change an exported type or an event name; see `CHANGELOG.md` in each package.

## Install

```bash
pnpm add @fluxgantt/core        # headless engine + SVG renderer
pnpm add @fluxgantt/react       # optional: React 18/19 wrapper
pnpm add @fluxgantt/vue         # optional: Vue 3 wrapper
```

## Quick start

Render a chart in ~15 lines (same code as
[`examples/plain-html-demo`](./examples/plain-html-demo);
[open it on StackBlitz](https://stackblitz.com/github/thai-pc/fluxgantt/tree/stackblitz/vanilla?file=src%2Fmain.ts&title=FluxGantt%20vanilla),
live after the next release, 404 until then):

```ts
import { createGantt, toTaskId } from '@fluxgantt/core';
import { withRender } from '@fluxgantt/core/render';
import { withInteraction } from '@fluxgantt/core/interaction';

// Rendering and interaction are opt-in mixins — a headless consumer (server-side
// scheduling, tests) never downloads them. Compose both for a live, editable chart.
const gantt = withInteraction(
  withRender(
    createGantt({
      tasks: [
        { id: toTaskId('design'), name: 'Design', start: '2026-08-03', end: '2026-08-05', progress: 1, type: 'task' },
        { id: toTaskId('build'), name: 'Build', start: '2026-08-05', end: '2026-08-10', progress: 0.6, type: 'task' },
        { id: toTaskId('review'), name: 'Review', start: '2026-08-10', end: '2026-08-12', progress: 0, type: 'task' },
        { id: toTaskId('launch'), name: 'Launch', start: '2026-08-12', end: '2026-08-12', progress: 0, type: 'milestone' },
        { id: toTaskId('docs-task'), name: 'Write docs', start: '2026-08-06', end: '2026-08-11', progress: 0.2, type: 'task' },
      ],
      dependencies: [
        { from: toTaskId('design'), to: toTaskId('build'), type: 'FS' },
        { from: toTaskId('build'), to: toTaskId('review'), type: 'FS' },
      ],
    }),
  ),
);

gantt.on('task:moved', (task, prevStart) => {
  console.log(`${task.name} moved from ${prevStart}`);
});

gantt.mount(document.getElementById('gantt')!);
```

Core needs `globalThis.Temporal`. In a browser without native Temporal (Safari, at the time of
writing) or in Node 22/24, `pnpm add @js-temporal/polyfill` and run this once, before the code
above (the examples do it in `src/temporal.ts`):

```ts
import { Temporal } from '@js-temporal/polyfill';

// Once, before the first createGantt(). A no-op where Temporal is native.
(globalThis as unknown as { Temporal?: typeof Temporal }).Temporal ??= Temporal;
```

Using React or Vue? See [`examples/react-vite-demo`](./examples/react-vite-demo)
([open on StackBlitz](https://stackblitz.com/github/thai-pc/fluxgantt/tree/stackblitz/react?file=src%2FApp.tsx&title=FluxGantt%20React)) and
[`examples/vue-vite-demo`](./examples/vue-vite-demo)
([open on StackBlitz](https://stackblitz.com/github/thai-pc/fluxgantt/tree/stackblitz/vue?file=src%2FApp.vue&title=FluxGantt%20Vue)).
The StackBlitz links go live with the next release and return a 404 until then.

## Features (Core, MIT)

- **Headless engine** — `createGantt()` needs no DOM. Schedule on the server, in a Worker, or in a
  test with no jsdom.
- **Rendering** — SVG renderer, zero required host CSS (inline `--fg-*` fallbacks); automatic
  Canvas fallback above 2000 tasks.
- **Dependencies** — FS / SS / FF / SF, with lag/lead; cycles rejected.
- **Hierarchy** — parent/child tasks, cascade remove, summary bars with rollup.
- **Critical path** — CPM (`computeCriticalPath()`), distinguishable without color (dashed outline).
- **Interactions** — drag to move / resize / create dependency; keyboard navigation; opt-in cascade.
- **Working calendar** — Temporal-based, DST-correct working-hours math.
- **Theming** — `withTheme()` for light/dark switching over `--fg-*` design tokens.
- **Responsive & touch** — `withResponsive()` adapts density, label column and hit targets to a
  coarse pointer, and owns panning so touch drags never fight the browser.
- **i18n** — host-injected message functions; dates localized through `Intl`.
- **Accessibility** — ARIA `treegrid`, focus indicators, `prefers-reduced-motion`; WCAG 2.1 AA.
- **Export / import** — JSON, CSV, SVG, PNG; strict, validated import.
- **Wrappers** — `@fluxgantt/react` (`<FluxGantt>` + `useFluxGantt`), `@fluxgantt/vue`.

## Bundle size

Rendering, interaction, IO, theming and responsive behaviour are **opt-in mixins on separate
subpath exports**, so you download what you compose and nothing else. Measured with `pnpm size`
(gzip, ESM bundler output), enforced as a budget on every pull request:

| What you compose | gzip |
|---|---|
| `createGantt()` — headless engine only | **<!--sz:hello.2-->7.41<!--/sz--> KiB** |
| `+ withIo` | <!--sz:io.2-->12.46<!--/sz--> KiB |
| `+ withRender` — a painted chart | <!--sz:render.2-->14.53<!--/sz--> KiB |
| `+ withRender + withInteraction` — a fully editable chart | **<!--sz:editable.2-->19.05<!--/sz--> KiB** |
| `+ withRender + withTheme` | <!--sz:theme.2-->15.18<!--/sz--> KiB |
| `+ withRender + withInteraction + withResponsive` | <!--sz:responsive.2-->20.46<!--/sz--> KiB |
| Every capability composed | <!--sz:kitchen.2-->23.71<!--/sz--> KiB |

Required host CSS: **none** — every visual property is written inline with a `--fg-*` token
fallback, so a stylesheet is only needed to *override* defaults.

For context, `dhtmlx-gantt@10.0.3` (the MIT Community edition) is **226 KiB gzip** including its
required stylesheet, and `frappe-gantt@1.2.2` is **14.9 KiB** — smaller than an editable FluxGantt
chart, because it has no critical path, no dependency types beyond finish-to-start, no working
calendar and no types. Those figures come from
[`tooling/scripts/measure-competitor-bundles.mjs`](./tooling/scripts/measure-competitor-bundles.mjs),
which packs each library from npm at a pinned version and gzips its own entry point, so you can
re-run them. The full breakdown, including where FluxGantt loses, is in
[`apps/docs/pages/docs/comparison.mdx`](./apps/docs/pages/docs/comparison.mdx).

## Tiers

| Tier | Price | Includes |
|---|---|---|
| **Core** (MIT) | Free | Rendering, dependencies (FS/SS/FF/SF), hierarchy, critical path, React/Vue, export PNG/SVG/JSON/CSV |
| **Pro** (one-time) | $299/dev | Resource view + leveling, baselines, constraints, MS Project XML I/O, PDF, custom columns, Svelte/Angular |
| **Cloud** (subscription) | from $29/month | Multiplayer (Yjs), comment/@mention, AI auto-schedule, risk forecast, integrations |

Only the **Core** tier exists today.

## Repo layout (monorepo — pnpm + turbo)

```
packages/    core, react, vue, svelte, angular, ai, msproject, cloud-sdk
examples/    demos per framework + feature (plain-html, react-vite, vue-vite)
apps/        docs (Vocs), landing, playground
tooling/     eslint-config, tsconfig, scripts
tests/       e2e, visual, a11y, mobile, performance (Playwright)
```

## Getting started with development

```bash
pnpm install
pnpm build        # turbo builds all packages
pnpm test         # unit tests (vitest)
pnpm test:e2e     # e2e (playwright)
pnpm lint && pnpm typecheck
```

Requirements: Node >= 22.19 (see `.nvmrc` for the exact pinned version), pnpm 10+.

## Links

- **Docs site** — built from [`apps/docs`](./apps/docs) (Vocs). Run `pnpm --filter docs dev`.
  (The hosted URL will be linked here once deployed.)
- **Examples** — [`examples/plain-html-demo`](./examples/plain-html-demo) (six pages: editable,
  read-only, selection, collapse, i18n, responsive) ·
  [`examples/react-vite-demo`](./examples/react-vite-demo) ·
  [`examples/vue-vite-demo`](./examples/vue-vite-demo). Each runs with
  `pnpm --filter <name> dev`; the catalogue is in
  [`apps/docs/pages/docs/examples.mdx`](./apps/docs/pages/docs/examples.mdx).
  Open on StackBlitz, built from the latest npm release:
  [vanilla](https://stackblitz.com/github/thai-pc/fluxgantt/tree/stackblitz/vanilla?file=src%2Fmain.ts&title=FluxGantt%20vanilla) · [React](https://stackblitz.com/github/thai-pc/fluxgantt/tree/stackblitz/react?file=src%2FApp.tsx&title=FluxGantt%20React) · [Vue](https://stackblitz.com/github/thai-pc/fluxgantt/tree/stackblitz/vue?file=src%2FApp.vue&title=FluxGantt%20Vue) · [headless](https://stackblitz.com/github/thai-pc/fluxgantt/tree/stackblitz/headless?file=index.mjs&title=FluxGantt%20headless).
  (The `stackblitz` branch these open is created by the next release; until then they 404.)
- **Comparison** vs dhtmlx, Bryntum and Frappe —
  [`apps/docs/pages/docs/comparison.mdx`](./apps/docs/pages/docs/comparison.mdx)

## Docs for AI / contributors

- [`CLAUDE.md`](./CLAUDE.md) — high-level context + golden rules
- [`.claude/rules/`](./.claude/rules) — architecture, conventions, testing, **security**
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — contribution workflow
- [`RELEASING.md`](./RELEASING.md) — how a version reaches npm (changesets)

## License

Core: [MIT](./LICENSE). Pro & Cloud under a separate commercial license.
