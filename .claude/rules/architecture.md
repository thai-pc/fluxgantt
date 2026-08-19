# Rule: Architecture

## Layered architecture (top to bottom)
```
User App (React/Vue/Svelte/Angular/vanilla)
        ↓
Framework Wrapper Layer  (@fluxgantt/react, /vue, ...)  — idiomatic per framework, type-safe props
        ↓
Core Engine (@fluxgantt/core)
   ├─ Public API     createGantt(), mount(), on()
   ├─ State Layer    TaskStore, DependencyStore, ResourceStore(Pro), BaselineStore(Pro), ViewportStore
   ├─ Compute Layer  critical-path (CPM), resource-leveling(Pro), auto-schedule(Cloud/AI), working-calendar, cascade
   ├─ Render Layer   SVG (<2000 tasks) | Canvas fallback (≥2000), switches automatically by task count
   ├─ Interaction    drag-move, drag-resize, drag-create-dep, keyboard-nav, selection, touch
   ├─ IO Layer       json, csv, export-png/svg/pdf, msproject(Pro)
   └─ Sync Layer     Yjs adapter, presence, conflict resolution (Cloud ONLY)
```

## 7 design principles (DO NOT violate)
1. **Headless first** — state + compute run without a DOM (server-side, tests). DOM only in the render/interaction layer.
2. **Reactive subscription, no full re-render** — consumers subscribe to a specific delta (task X moved, dep Y added), not a full snapshot. Required to scale to 1000+ tasks.
3. **Plugin for non-core** — MS Project, AI, custom calendar are separate plugins. Core bundle < 36kb gzip (raised from 30kb→32kb after keyboard-nav/a11y landed, 32kb→34kb after undo/redo landed, then 34kb→36kb after import/export facade wiring landed — all are Core-wide editor baseline UX, not plugin candidates). This budget is enforced mechanically in CI via `pnpm size` (`packages/core/.size-limit.json`) — see `.claude/work/spec-bundle-size-ci.md`.
4. **Tree-shakable everything** — import only what you need. "Hello world" < 22kb gzip (re-baselined 2026-08; see CLAUDE.md golden rule 5 — the previous 15kb figure was never CI-verified, and the real, now-enforced measurement is ~21.3kb because the `Gantt` facade class doesn't tree-shake well yet).
5. **Core agnostic, wrapper opinionated** — core doesn't know React/Vue. Wrappers provide the idiomatic API (hooks/composables/runes).
6. **Type safety end-to-end** — branded IDs, strict null checks everywhere.
7. **Server-friendly** — runs in Node/Workers without a DOM.

## State management
A reactive store built on a **hand-rolled signal** (Preact-Signals-like semantics), **zero dependency on React/Vue**. File: `packages/core/src/signals.ts`. Stores in `packages/core/src/store/`.

## Rendering
- **SVG** by default (clean, vector, accessible, exportable).
- **Canvas** fallback automatically when task count > 2000. The two renderers share `renderer-base.ts`.
- Virtual scrolling for large projects.

## Date arithmetic
**Temporal API** (`@js-temporal/polyfill`) for all date/time math. Reason: correct timezone + DST; native `Date` is not trustworthy. `date-fns` only for minor ergonomics. Native `Date` only at the serialize/deserialize boundary.

## Type system (spec §6)
- **Branded IDs**: `type TaskId = Brand<string,'TaskId'>` — prevents mixing `TaskId` with `ResourceId` at compile time.
- Core entities: `Task`, `Dependency` (+ `DependencyType` FS/SS/FF/SF), `TaskConstraint` (discriminated union by `kind`), `Resource`, `ResourceAssignment`, `Baseline`, `WorkingCalendar`.
- Config: `GanttConfig` (tasks/deps/resources/baselines + viewMode/density/theme/rtl/locale + feature flags + callbacks).

## Core algorithms
- **Critical Path (CPM)**: topological sort → forward pass (ES/EF) → backward pass (LS/LF) → slack=0. Handles cycle (throw), constraint, working calendar, lag/lead. Full pseudocode in Appendix B of the spec.
- **Resource Leveling (Pro)**: heuristic; shift tasks with high slack / low priority to resolve over-allocation without breaking dependencies.
- **AI Auto-Schedule (Cloud)**: an LLM (claude-sonnet) extracts tasks/deps from natural language → applies constraints → topo sort → level → validate. AI "suggests", doesn't "decide"; always shows reasoning, easy to revert.

## When adding a new package
Follow the `@fluxgantt/*` NPM scope. Separate tiers clearly. A wrapper depends only on `@fluxgantt/core` + its framework.
