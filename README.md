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
> **Pre-release — not on npm yet.** The packages are `0.0.0` and unpublished while the tiers and
> API stabilize pre-1.0. Run FluxGantt **from source** for now:
> ```bash
> git clone https://github.com/thai-pc/fluxgantt
> cd fluxgantt && pnpm install && pnpm build
> pnpm --filter plain-html-demo dev   # or react-vite-demo / vue-vite-demo
> ```
> The `pnpm add @fluxgantt/core` command below is the target end-state once published.

## Install

```bash
pnpm add @fluxgantt/core        # headless engine + SVG renderer
pnpm add @fluxgantt/react       # optional: React 18/19 wrapper
pnpm add @fluxgantt/vue         # optional: Vue 3 wrapper
```

## Quick start

Render a chart in ~15 lines (same code as
[`examples/plain-html-demo`](./examples/plain-html-demo)):

```ts
import { createGantt, toTaskId } from '@fluxgantt/core';

const gantt = createGantt({
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
});

gantt.on('task:moved', (task, prevStart) => {
  console.log(`${task.name} moved from ${prevStart}`);
});

gantt.mount(document.getElementById('gantt')!);
```

Using React or Vue? See [`examples/react-vite-demo`](./examples/react-vite-demo) and
[`examples/vue-vite-demo`](./examples/vue-vite-demo).

## Features (Core, MIT)

- **Rendering** — SVG renderer, zero required host CSS (inline `--fg-*` fallbacks).
- **Dependencies** — FS / SS / FF / SF, with lag/lead; cycles rejected.
- **Hierarchy** — parent/child tasks, cascade remove, summary bars.
- **Critical path** — CPM (`computeCriticalPath()`), distinguishable without color (dashed outline).
- **Interactions** — drag to move / resize / create dependency; opt-in cascade.
- **Working calendar** — Temporal-based, DST-correct working-hours math.
- **Export / import** — JSON, CSV, SVG, PNG; strict, validated import.
- **Wrappers** — `@fluxgantt/react` (`<FluxGantt>` + `useFluxGantt`), `@fluxgantt/vue`.

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
tests/       e2e, visual, a11y, performance (Playwright)
```

## Getting started with development

```bash
pnpm install
pnpm build        # turbo builds all packages
pnpm test         # unit tests (vitest)
pnpm test:e2e     # e2e (playwright)
pnpm lint && pnpm typecheck
```

Requirements: Node >= 20 (22 recommended), pnpm 10+.

## Links

- **Docs site** — built from [`apps/docs`](./apps/docs) (Vocs). Run `pnpm --filter docs dev`.
  (The hosted URL will be linked here once deployed.)
- **Examples** — [`examples/plain-html-demo`](./examples/plain-html-demo) ·
  [`examples/react-vite-demo`](./examples/react-vite-demo) ·
  [`examples/vue-vite-demo`](./examples/vue-vite-demo)

## Docs for AI / contributors

- [`CLAUDE.md`](./CLAUDE.md) — high-level context + golden rules
- [`.claude/rules/`](./.claude/rules) — architecture, conventions, testing, **security**
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — contribution workflow

## License

Core: [MIT](./LICENSE). Pro & Cloud under a separate commercial license.
