# Rule: Architecture

## Layered architecture (từ trên xuống)
```
User App (React/Vue/Svelte/Angular/vanilla)
        ↓
Framework Wrapper Layer  (@fluxgantt/react, /vue, ...)  — idiomatic per framework, type-safe props
        ↓
Core Engine (@fluxgantt/core)
   ├─ Public API     createGantt(), mount(), on()
   ├─ State Layer    TaskStore, DependencyStore, ResourceStore(Pro), BaselineStore(Pro), ViewportStore
   ├─ Compute Layer  critical-path (CPM), resource-leveling(Pro), auto-schedule(Cloud/AI), working-calendar, cascade
   ├─ Render Layer   SVG (<2000 task) | Canvas fallback (≥2000), tự chuyển theo task count
   ├─ Interaction    drag-move, drag-resize, drag-create-dep, keyboard-nav, selection, touch
   ├─ IO Layer       json, csv, export-png/svg/pdf, msproject(Pro)
   └─ Sync Layer     Yjs adapter, presence, conflict resolution (CHỈ Cloud)
```

## 7 design principles (KHÔNG vi phạm)
1. **Headless first** — state + compute chạy không cần DOM (server-side, test). DOM chỉ ở render/interaction layer.
2. **Reactive subscription, không full re-render** — consumer subscribe vào delta cụ thể (task X moved, dep Y added), không nhận full snapshot. Cần để scale 1000+ task.
3. **Plugin cho non-core** — MS Project, AI, custom calendar là plugin riêng. Core bundle < 30kb gzip.
4. **Tree-shakable mọi thứ** — chỉ import cái cần. "Hello world" < 15kb gzip.
5. **Core agnostic, wrapper opinionated** — core không biết React/Vue. Wrapper cho API idiomatic (hooks/composable/runes).
6. **Type safety end-to-end** — branded ID, strict null check khắp nơi.
7. **Server-friendly** — chạy trong Node/Workers không cần DOM.

## State management
Reactive store dựa trên **signal tự viết** (semantics giống Preact Signals), **zero dependency với React/Vue**. File: `packages/core/src/signals.ts`. Store ở `packages/core/src/store/`.

## Rendering
- **SVG** mặc định (sạch, vector, accessible, exportable).
- **Canvas** fallback tự động khi task count > 2000. Hai renderer chia sẻ `renderer-base.ts`.
- Virtual scrolling cho project lớn.

## Date arithmetic
**Temporal API** (`@js-temporal/polyfill`) cho mọi tính toán ngày giờ. Lý do: timezone + DST đúng, native `Date` không đáng tin. `date-fns` chỉ cho ergonomics phụ. Native `Date` chỉ ở boundary serialize/deserialize.

## Type system (mục 6 spec)
- **Branded ID**: `type TaskId = Brand<string,'TaskId'>` — ngăn trộn `TaskId` với `ResourceId` ở compile time.
- Core entities: `Task`, `Dependency` (+ `DependencyType` FS/SS/FF/SF), `TaskConstraint` (discriminated union theo `kind`), `Resource`, `ResourceAssignment`, `Baseline`, `WorkingCalendar`.
- Config: `GanttConfig` (tasks/deps/resources/baselines + viewMode/density/theme/rtl/locale + feature flags + callbacks).

## Thuật toán cốt lõi
- **Critical Path (CPM)**: topological sort → forward pass (ES/EF) → backward pass (LS/LF) → slack=0. Xử lý cycle (throw), constraint, working calendar, lag/lead. Pseudocode đầy đủ ở Appendix B của spec.
- **Resource Leveling (Pro)**: heuristic, dịch task có slack cao / priority thấp để giải over-allocation mà không phá dependency.
- **AI Auto-Schedule (Cloud)**: LLM (claude-sonnet) trích task/dep từ natural language → áp constraint → topo sort → level → validate. AI là "suggest" không "decide", luôn show reasoning, revert dễ.

## Khi thêm package mới
Theo NPM scope `@fluxgantt/*`. Tách rõ tier. Wrapper chỉ phụ thuộc `@fluxgantt/core` + framework đó.
