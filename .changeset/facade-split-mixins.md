---
"@fluxgantt/core": minor
"@fluxgantt/react": patch
"@fluxgantt/vue": patch
---

refactor(core)!: split the monolithic `Gantt` facade into a base instance plus three opt-in capability mixins

**Breaking change.** `createGantt(config)` now returns the *headless base* instance only. The
IO, rendering and interaction methods it used to carry are opt-in mixins, each on its own
subpath export:

| Subpath | Mixin | Adds |
|---|---|---|
| `@fluxgantt/core/io` | `withIo` | `exportJson`/`exportCsv`/`exportSvg`/`exportPng`, `importJson`/`importCsv` |
| `@fluxgantt/core/render` | `withRender` | `mount()`, `unmount()`, `refresh()` |
| `@fluxgantt/core/interaction` | `withInteraction` | no new methods — wires drag-move/resize, drag-create-dependency, click-select and keyboard navigation into every `mount()` |

```ts
import { createGantt, toTaskId } from '@fluxgantt/core';
import { withRender } from '@fluxgantt/core/render';
import { withInteraction } from '@fluxgantt/core/interaction';

const gantt = withInteraction(withRender(createGantt({ tasks })));
gantt.mount(document.getElementById('gantt')!);
```

Each mixin returns the *same* instance (augmented in place) with a widened type, so application
order does not matter — but **apply every mixin before the first `mount()` call**: interaction
hooks are consulted while a mount is being built, so composing `withInteraction` onto an
already-mounted instance takes effect only on the next mount. This is a documented v1 limitation.

**Why.** Class prototype methods can never be tree-shaken. As one monolithic class, the facade
billed every consumer for the IO, render *and* interaction bytes whether they called them or not
— a headless server-side scheduling consumer downloaded the SVG renderer, and a read-only chart
downloaded the CSV exporter. The budget had ~0.25 KiB of headroom left before this change.

**Measured effect** (gzip, esbuild fixture bundles in `packages/core/size-limit/`):

| Fixture | Before | After |
|---|---|---|
| `createGantt()` only | 22.3 KiB | **7.51 KiB** |
| `+ withIo` | — | 12.45 KiB |
| `+ withRender` | — | 13.47 KiB |
| `+ withRender + withInteraction` | — | 17.40 KiB |
| everything (≡ the pre-split facade) | 34.9 KiB | **22.01 KiB** |

`.size-limit.json` now enforces one budget per fixture. The old file-based "Full core" check on
`dist/index.js` is gone: `tsup`'s code splitting moves shared code into `chunk-*.js`, so reading
that one file's size no longer reflects what any consumer actually downloads. The `kitchen-sink`
fixture replaces it.

**Barrel trimming.** `createSvgRenderer`, `CANVAS_AUTO_SWITCH_THRESHOLD`, the `enableDrag*`/keyboard/selection helpers and the
`exportJson`/`importCsv`-family free functions are no longer re-exported from `@fluxgantt/core`.
Import them from `@fluxgantt/core/render`, `/interaction` and `/io` respectively — re-exporting
them from the root barrel pinned the renderer and the IO layer into every consumer's module
graph, defeating the split.

**Migration.** Wrap your `createGantt()` call in the mixins for the capabilities you use:

```diff
-const gantt = createGantt({ tasks });
+const gantt = withInteraction(withRender(createGantt({ tasks })));
```

`@fluxgantt/react` and `@fluxgantt/vue` compose `withRender` + `withInteraction` internally, so
their public surface is unchanged — a wrapper is by definition a rendering, interactive consumer.
They deliberately do *not* compose `withIo`, so wrapper users who never import or export stop
paying for that code.
