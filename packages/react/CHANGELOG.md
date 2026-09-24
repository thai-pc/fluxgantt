# @fluxgantt/react

## 0.1.1

### Patch Changes

- 6928a33: Add npm registry metadata (`repository`, `homepage`, `bugs`, `keywords`, `author`) to the
  published packages, so the package page links back to the source directory and the docs site.
- 5a66fb1: Include `CHANGELOG.md` in the published tarball, so the release notes changesets generates are
  visible to consumers on npm rather than only on GitHub.
- 0bde36a: Ship a real `LICENSE` in each package tarball, and document why the published `.d.ts` files import
  the `Temporal` type from `@js-temporal/polyfill`.
  
  pnpm already injected the workspace-root LICENSE at pack time, so this changes nothing for anyone
  installing from a pnpm-built tarball. It matters because the license text no longer depends on
  which packer ran: `files` now lists `LICENSE` explicitly, and the file is a real copy in each
  package (`npm pack` does not follow symlinks).
  
  The Temporal note is documentation only — no code moved. `@js-temporal/polyfill` stays an optional
  peer, correctly: core bundles none of it and resolves `globalThis.Temporal` at runtime. But the
  type import in the shipped declarations means a TypeScript consumer compiling with
  `skipLibCheck: false` needs the package installed even on a native-Temporal runtime. Both ways out
  were measured and are worse — `temporal-spec`'s `Duration.round` overloads make real polyfill
  instances non-assignable (`TS2345` at the consumer's call site), and TypeScript's built-in
  `lib.esnext.temporal` does not exist before TypeScript 6 — so the README and the installation page
  now say plainly what to install and why.
- 8ca882d: Ship a README with each package, so npmjs.com renders install instructions, a runnable example
  and a link to the docs instead of an empty page.
- Updated dependencies [cb53a4e]
- Updated dependencies [6928a33]
- Updated dependencies [58284cf]
- Updated dependencies [c103cfd]
- Updated dependencies [5a66fb1]
- Updated dependencies [5e4c470]
- Updated dependencies [31c1296]
- Updated dependencies [334debe]
- Updated dependencies [0bde36a]
- Updated dependencies [8ca882d]
- Updated dependencies [4ad3ec0]
  - @fluxgantt/core@0.2.0

## 0.1.0

### Minor Changes

- 078ba05: feat(react): add the `@fluxgantt/react` wrapper

  New package: an idiomatic React wrapper for `@fluxgantt/core`'s `createGantt()` facade.

  - `<FluxGantt>` — the primary component (forwardRef; the `ref` exposes the full
    `GanttInstance`). Renders a container `<div>` and mounts the chart into it.
  - `useFluxGantt(config)` — the lower-layer hook `<FluxGantt>` wraps, returning
    `{ ref, instance }`.
  - Discrete callback props, one per core event: `onTaskAdded`/`onTaskMoved`/`onTaskResized`/
    `onTaskProgressed`/`onTaskRemoved`/`onDependencyAdded`/`onDependencyRemoved`/
    `onCriticalPathComputed`. `onTaskChange` passes straight through to `GanttConfig`.

  Uncontrolled-first: `tasks`/`dependencies` (and `calendar`/`viewMode`/`density`/`locale`/
  `readOnly`) are read once at construction — the `GanttInstance` is the source of truth
  afterwards; mutate via the instance/ref. StrictMode-safe (instance created once via lazy
  ref; the mount effect's cleanup calls `unmount()`, never `destroy()`). React
  `^18.2.0 || ^19.0.0` peer (via `forwardRef`). Ships a `"use client"` banner for Next.js App
  Router. Invalid initial config re-throws with an `@fluxgantt/react`-tagged message.

  `viewMode`/`density`/`locale`/`readOnly`/`calendar` are construction-only in v1 (the facade
  has no setters yet) — use a `key`-remount to change them. Not in v1: controlled task syncing,
  SSR/RSC, `@fluxgantt/vue`.

### Patch Changes

- 7986f80: refactor(core)!: split the monolithic `Gantt` facade into a base instance plus three opt-in capability mixins

  **Breaking change.** `createGantt(config)` now returns the _headless base_ instance only. The
  IO, rendering and interaction methods it used to carry are opt-in mixins, each on its own
  subpath export:

  | Subpath                       | Mixin             | Adds                                                                                                                       |
  | ----------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
  | `@fluxgantt/core/io`          | `withIo`          | `exportJson`/`exportCsv`/`exportSvg`/`exportPng`, `importJson`/`importCsv`                                                 |
  | `@fluxgantt/core/render`      | `withRender`      | `mount()`, `unmount()`, `refresh()`                                                                                        |
  | `@fluxgantt/core/interaction` | `withInteraction` | no new methods — wires drag-move/resize, drag-create-dependency, click-select and keyboard navigation into every `mount()` |

  ```ts
  import { createGantt, toTaskId } from '@fluxgantt/core';
  import { withRender } from '@fluxgantt/core/render';
  import { withInteraction } from '@fluxgantt/core/interaction';

  const gantt = withInteraction(withRender(createGantt({ tasks })));
  gantt.mount(document.getElementById('gantt')!);
  ```

  Each mixin returns the _same_ instance (augmented in place) with a widened type, so application
  order does not matter — but **apply every mixin before the first `mount()` call**: interaction
  hooks are consulted while a mount is being built, so composing `withInteraction` onto an
  already-mounted instance takes effect only on the next mount. This is a documented v1 limitation.

  **Why.** Class prototype methods can never be tree-shaken. As one monolithic class, the facade
  billed every consumer for the IO, render _and_ interaction bytes whether they called them or not
  — a headless server-side scheduling consumer downloaded the SVG renderer, and a read-only chart
  downloaded the CSV exporter. The budget had ~0.25 KiB of headroom left before this change.

  **Measured effect** (gzip, esbuild fixture bundles in `packages/core/size-limit/`):

  | Fixture                             | Before   | After         |
  | ----------------------------------- | -------- | ------------- |
  | `createGantt()` only                | 22.3 KiB | **7.51 KiB**  |
  | `+ withIo`                          | —        | 12.45 KiB     |
  | `+ withRender`                      | —        | 13.47 KiB     |
  | `+ withRender + withInteraction`    | —        | 17.40 KiB     |
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
  They deliberately do _not_ compose `withIo`, so wrapper users who never import or export stop
  paying for that code.

- 9cbeb9d: fix(react): deliver the initial `critical-path:computed` to `onCriticalPathComputed`

  The mount effect called `instance.mount()` before subscribing the event bridges, but `mount()`
  runs the renderer's reactive effect synchronously and emits the initial `critical-path:computed`
  for any initial tasks — so that first event was missed. Subscriptions now happen before
  `mount()` (`on()` works headless), so `onCriticalPathComputed` receives the initial computation.

- Updated dependencies [9d8a42d]
- Updated dependencies [f040cf9]
- Updated dependencies [02a9e59]
- Updated dependencies [59df15a]
- Updated dependencies [d4f26e7]
- Updated dependencies [f3f107a]
- Updated dependencies [1ca8a67]
- Updated dependencies [47c1a40]
- Updated dependencies [4f192b2]
- Updated dependencies [d3422c6]
- Updated dependencies [5fc8746]
- Updated dependencies [7f4df10]
- Updated dependencies [731902f]
- Updated dependencies [df70560]
- Updated dependencies [d4655c0]
- Updated dependencies [ce92382]
- Updated dependencies [7986f80]
- Updated dependencies [6096edb]
- Updated dependencies [078ba05]
- Updated dependencies [26eb3d6]
- Updated dependencies [6e3bee5]
- Updated dependencies [fc07b88]
- Updated dependencies [a87302b]
- Updated dependencies [a88271f]
- Updated dependencies [2c76e69]
- Updated dependencies [e2b4a28]
- Updated dependencies [a69b85e]
- Updated dependencies [5ee6168]
- Updated dependencies [95db331]
- Updated dependencies [4632393]
  - @fluxgantt/core@0.1.0
