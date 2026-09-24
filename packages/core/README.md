# @fluxgantt/core

The headless engine behind [FluxGantt](https://github.com/thai-pc/fluxgantt) — a TypeScript-first,
MIT-licensed Gantt chart library. State, scheduling and compute run without a DOM; rendering,
interaction and IO are opt-in mixins on their own subpath exports, so you only ship what you use.

- **Docs:** https://thai-pc.github.io/fluxgantt
- **Repository:** https://github.com/thai-pc/fluxgantt

## Install

```bash
pnpm add @fluxgantt/core
```

Date and time maths use the [Temporal API](https://tc39.es/proposal-temporal/docs/). On a runtime
without it, also install the optional peer dependency:

```bash
pnpm add @js-temporal/polyfill
```

It is optional **at runtime only** — the bundle contains no polyfill code, and `getTemporal()`
reads `globalThis.Temporal`, so a runtime with native Temporal needs nothing installed. But the
published `.d.ts` files re-export `Temporal.ZonedDateTime` from `@js-temporal/polyfill`, which is
the only accurate type for what those APIs accept: `temporal-spec`'s structurally-different
`Duration.round` overloads make polyfill instances non-assignable, and the TS 6 global
(`lib.esnext.temporal`) does not exist before TypeScript 6. So **TypeScript consumers should
install it even on a native-Temporal runtime**, at least as a devDependency — otherwise
`skipLibCheck: false` reports `TS2307` against our declaration files. `skipLibCheck: true` (the
`tsc --init` default) hides it either way.

## Quick start

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

## Entry points

`createGantt()` on its own is headless — it never touches the DOM, so it runs in Node, in a
Worker, and in tests. Each capability is a separate subpath, and each is tree-shakable because it
is a function, not a prototype method:

| Import | Adds |
|---|---|
| `@fluxgantt/core` | `createGantt()`, the task/dependency stores, critical path, working calendar |
| `@fluxgantt/core/io` | `withIo()` — JSON/CSV import & export, PNG/SVG export |
| `@fluxgantt/core/render` | `withRender()` — SVG renderer, with an automatic Canvas fallback above 2000 tasks |
| `@fluxgantt/core/interaction` | `withInteraction()` — drag-move, drag-resize, draw dependencies, keyboard navigation |
| `@fluxgantt/core/theme` | `withTheme()` — light/dark and `--fg-*` design tokens |
| `@fluxgantt/core/responsive` | `withResponsive()` — touch gestures and a layout that adapts to the container |

## Bundle size

Measured gzip, enforced in CI against real fixtures:

| Composition | gzip |
|---|---|
| `createGantt()` alone | 7.71 KiB |
| `+ withRender()` | 14.74 KiB |
| `+ withRender() + withInteraction()` | 19.17 KiB |
| everything | 23.82 KiB |

## Framework wrappers

[`@fluxgantt/react`](https://www.npmjs.com/package/@fluxgantt/react) ·
[`@fluxgantt/vue`](https://www.npmjs.com/package/@fluxgantt/vue)

## License

MIT
