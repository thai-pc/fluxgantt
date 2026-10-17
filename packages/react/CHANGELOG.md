# @fluxgantt/react

## 0.4.0

### Minor Changes

- 630bc02: Right-to-left charts. New subpath `@fluxgantt/core/rtl` exports `withRtl()` (no new methods) and `GanttConfig` gains `rtl?: boolean` (default `false`, read only by `withRtl`, inert without it, construction-time only). With `rtl: true` the whole chart is mirrored in both renderers: the earliest date and the label column sit at the right, text stays upright and gets an RTL base direction, the container gets `dir="rtl"` (restored on unmount), and `exportSvg()` / `exportPng()` (SVG and Canvas mode) export the mirrored chart. Zoom anchoring, `scrollToTask()` and `scrollToDate()` use the logical scroll offset of a RTL scroll container (`scrollLeft` runs from 0 down to negative). Dragging a bar visually left moves it later; resize grabs the visually-left (end) edge; the link rubber band starts at the mirrored handle; Canvas hit-testing, the drag overlay and edit-hook label classification follow the mirror. Not included: translated built-in strings (use `messages`), a runtime toggle, left-edge resize. See the new "Right-to-left charts" docs page.
  
  Additions to published types (all optional, marked for `withRtl`; do not rely on them): `SvgRendererOptions.onPaint`, `CanvasRendererOptions.rtl` and `InteractiveRendererHandle.mirrorX` (the single "is mirrored" predicate); `hitTestRow` results gain an optional `onLabel`. The new `with-rtl` size fixture is `withRender + withRtl`; every existing fixture grew by at most 61 B (hello world, `+ withIo` and `+ withConflicts` by 0 B) and no existing limit moved.
  
  `@fluxgantt/react` and `@fluxgantt/vue`: new `rtl` prop (construction-time; change `key` to switch). Both compose `withRtl` unconditionally, which is a no-op unless `rtl` is true; the cost is about 400 B gzip in every wrapper bundle, including left-to-right ones (a deliberate choice: one composition, no dynamic import).

### Patch Changes

- Updated dependencies [acaf680]
- Updated dependencies [1669969]
- Updated dependencies [92f5958]
- Updated dependencies [128700d]
- Updated dependencies [630bc02]
- Updated dependencies [d7d27db]
- Updated dependencies [9702f98]
  - @fluxgantt/core@0.5.0

## 0.3.1

### Patch Changes

- Updated dependencies [7d4664d]
- Updated dependencies [370c132]
- Updated dependencies [3480f95]
- Updated dependencies [0c280ad]
  - @fluxgantt/core@0.4.0

## 0.3.0

### Minor Changes

- a733406: Forward every `GanttConfig` field. `ariaLabel`, `messages`, `theme`, `canvasViewportHeight`,
  `schedulingMode`, `historyLimit`, `initialCollapsed` and `rollup` type-checked before but were
  silently ignored by `<FluxGantt>` / `useFluxGantt`; they now reach `createGantt`. A new
  `CONFIG_DISPOSITION` table makes the compiler fail when core adds a config key the wrapper does
  not account for.
  
  `theme` is reactive: the wrapper now composes `withTheme`, so changing the prop calls `setTheme()`,
  and `setTheme` / `getTheme` / `getResolvedTheme` (`ThemeCapability`) are available on the ref and
  on `useFluxGantt().instance`. One deliberate exception to "unset means the core default": an unset
  `theme` is `'light'` here, not core's `'auto'`, so existing charts do not turn dark on a dark-mode
  OS after upgrading. Pass `theme="auto"` to follow the OS. Anything that hand-implements
  `FluxGanttRef` (for example a test mock) now needs the three theme methods.
  
  `rollup` is documented as a `RollupProvider` (`rollup={computeRollup}`), not a boolean.

### Patch Changes

- Updated dependencies [a733406]
- Updated dependencies [75db6a1]
  - @fluxgantt/core@0.3.1

## 0.2.0

### Minor Changes

- bbfeebf: Add `onTaskActivated` and `onTaskContextRequested` props (the `task:activated` and
  `task:context-requested` core events) and pass through `enableDependencyDrag`. The wrapper now
  composes `withEditHooks`, about 0.9 KiB gzip. Call `payload.preventDefault()` in the handler to
  suppress the native context menu.
- bbfeebf: Add `scrollToTask()`, `scrollToDate()` and runtime `setDensity()` as an opt-in `withViewport()`
  mixin on the new `@fluxgantt/core/viewport` subpath. `scrollToTask` scrolls a task's row and bar
  into view (expanding collapsed ancestors by default, never moving focus or selection),
  `scrollToDate` scrolls horizontally to a date, and `setDensity` changes row density on a live chart
  while keeping the top visible row in place. `viewport:changed` gains an optional `density` field
  (present only when emitted by `setDensity`). After `setDensity()` is called, `withResponsive` stops
  switching density. `@fluxgantt/react` and `@fluxgantt/vue` compose `withViewport`, so the methods
  are available on `FluxGanttRef` and the `useFluxGantt` instance.

### Patch Changes

- Updated dependencies [bbfeebf]
- Updated dependencies [bbfeebf]
- Updated dependencies [bbfeebf]
- Updated dependencies [bbfeebf]
- Updated dependencies [bbfeebf]
- Updated dependencies [bbfeebf]
- Updated dependencies [bbfeebf]
  - @fluxgantt/core@0.3.0

## 0.1.2

### Patch Changes

- Updated dependencies [020c4fc]
  - @fluxgantt/core@0.2.1

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
