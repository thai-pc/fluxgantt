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
   ├─ Compute Layer  critical-path (CPM, MIT), resource-leveling(Pro), working-calendar, cascade
   ├─ Render Layer   SVG (<2000 tasks) | Canvas fallback (≥2000), switches automatically by task count
   ├─ Interaction    drag-move, drag-resize, drag-create-dep, keyboard-nav, selection, touch
   ├─ IO Layer       json, csv, export-png/svg/pdf, msproject(Pro)
   └─ Sync Layer     Yjs adapter (separate package, customer-run backend; built only on pre-sold demand)
```

## 7 design principles (DO NOT violate)
1. **Headless first** — state + compute run without a DOM (server-side, tests). DOM only in the render/interaction layer.
2. **Reactive subscription, no full re-render** — consumers subscribe to a specific delta (task X moved, dep Y added), not a full snapshot. Required to scale to 1000+ tasks.
3. **Plugin for non-core** — MS Project, AI, custom calendar are separate plugins. Rendering, interaction and IO are opt-in mixins, so a fully-composed core instance (base + `withIo` + `withRender` + `withInteraction`, the kitchen sink) is ~25.9 KiB gzip against a 26.25 KiB hard limit (the 4th hard gate, `size-limit/everything.js`, composes every mixin). Sizes exclude the Temporal polyfill (~45.8 KiB gzip, needed where Temporal is not native, e.g. Node 22/24). Enforced in CI via `pnpm size`: four hard gates, ten report-only fixtures — see CLAUDE.md golden rule 5 for the policy, table and exemption rule.
4. **Tree-shakable everything** — import only what you need, and this is structural rather than aspirational: rendering, interaction and IO are opt-in mixins on separate subpath exports (`@fluxgantt/core/render`, `/interaction`, `/io`, `/theme`, `/responsive`, `/viewport`, `/conflicts`, `/edit-hooks`, `/rtl`, `/grid`, `/grid-editing`), because class prototype methods never tree-shake. "Hello world" (`createGantt()` alone) is ~8.2 KiB gzip (hard limit 8.25 KiB), excluding the Temporal polyfill. The budget protects the order of magnitude, not every hundred bytes; the exemption rule for correctness/security/a11y/performance fixes is in CLAUDE.md golden rule 5.
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
- **AI integration (MIT)**: an MCP server exposing the headless engine as tools, plus `llms.txt`, so AI assistants can find and drive FluxGantt.
- **AI Auto-Schedule (not committed / exploratory, was Cloud)**: an LLM extracts tasks/deps from natural language → applies constraints → topo sort → level → validate. Removed from the committed roadmap in the 2026-11 strategy revision; if it is ever built, AI "suggests", doesn't "decide" (always show reasoning, easy to revert) and `.claude/rules/security.md` §3 applies.

## When adding a new package
Follow the `@fluxgantt/*` NPM scope. Separate tiers clearly. A wrapper depends only on `@fluxgantt/core` + its framework.
