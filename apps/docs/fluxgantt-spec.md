# FluxGantt — Technical Specification

> **The Modern MIT-Licensed Gantt Chart Library**

| | |
|---|---|
| **Version** | 0.1.2 (Pre-launch Draft — revised) |
| **Status** | Planning / Pre-build |
| **Author** | Flux Toolkit Team |
| **License** | Core MIT · Pro Commercial · Cloud SaaS |
| **Date** | 2026 |

---

## Overview

FluxGantt is a TypeScript-first, MIT-licensed Gantt chart library targeting the gap between two extremes: expensive commercial solutions (dhtmlx Gantt $599–1,599/dev/year, Bryntum $850+/dev/year) and weak open-source options (Frappe Gantt, jsGantt Improved — all lacking features, TypeScript, and modern framework wrappers).

The product is part of the Flux family (alongside FluxFiles — a file manager), sharing a brand to reduce marketing cost and create a consistent developer experience.

**Three monetization tiers:**

- **Core (MIT, free)** — full Gantt rendering, dependencies, hierarchy
- **Pro (one-time)** — resource view, baselines, MS Project I/O, no AI
- **Cloud (subscription)** — hosted multiplayer, AI auto-scheduling, integrations

The primary audience is the **developer** embedding a Gantt into their web app, not the direct end user — this orientation drives every decision from API design to pricing.

**Core architecture:** a headless engine (state + logic) fully decoupled from the rendering layer, rendering to SVG (Canvas fallback above 2,000 tasks), state managed by a hand-rolled reactive signal (no React/Vue dependency), and date/time computation using the Temporal API for correct timezone/DST handling.

**3-wave roadmap:** Wave 1 (weeks 1–8) ships the Core MIT MVP to attract GitHub stars; Wave 2 (weeks 11–18) adds the Pro tier (resource leveling, baseline, MS Project XML); Wave 3 (month 6+) builds the Cloud tier with real-time multiplayer and AI auto-schedule.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Market Analysis](#2-market-analysis)
3. [Product Positioning & Branding](#3-product-positioning--branding)
4. [Technology Stack](#4-technology-stack)
5. [System Architecture](#5-system-architecture)
6. [Core Type System](#6-core-type-system)
7. [Public API Specification](#7-public-api-specification)
8. [UI/UX Design System](#8-uiux-design-system)
9. [Feature Roadmap (3 Waves)](#9-feature-roadmap-3-waves)
10. [API Naming Conventions](#10-api-naming-conventions)
11. [Code Organization](#11-code-organization)
12. [Database Schema (Cloud Tier)](#12-database-schema-cloud-tier)
13. [Algorithms Reference](#13-algorithms-reference)
14. [Pricing & Monetization](#14-pricing--monetization)
15. [Distribution & Launch Strategy](#15-distribution--launch-strategy)
16. [18-Week Execution Plan](#16-18-week-execution-plan)
17. [Validation Milestones](#17-validation-milestones)
18. [Risk Assessment & Mitigation](#18-risk-assessment--mitigation)
19. [Appendix A: Sample Task JSON Schema](#19-appendix-a-sample-task-json-schema)
20. [Appendix B: Critical Path Algorithm Pseudocode](#20-appendix-b-critical-path-algorithm-pseudocode)
21. [Appendix C: Competitor Comparison Matrix](#21-appendix-c-competitor-comparison-matrix)

---

## 1. Executive Summary

FluxGantt is a TypeScript-first, MIT-licensed Gantt chart library targeting the gap between expensive commercial solutions (dhtmlx Gantt $599–1,599/developer/year, Bryntum $850+/developer/year) and weak open-source options (Frappe Gantt, jsGantt-improved, old jQuery plugins).

The product is part of the Flux family of modern web tools, alongside FluxFiles (a file manager). The shared brand reduces marketing cost, builds a long-term moat through a consistent developer experience, and enables cross-promotion between products.

Three monetization tiers are planned:

- **Core (MIT, free):** Full Gantt rendering, dependencies, hierarchy
- **Pro (one-time):** Resource view, baselines, MS Project I/O, no AI
- **Cloud (subscription):** Hosted multiplayer, AI auto-scheduling, integrations

The product targets developers embedding Gantt features into their own web apps, not direct end users. This orientation drives every decision, from API design to the pricing model.

---

## 2. Market Analysis

### 2.1 Competitor Landscape

**Commercial / Closed Source:**

| Product | License | Pricing | Stack | Strengths | Weaknesses |
|---|---|---|---|---|---|
| **dhtmlx Gantt PRO** | Commercial | $599/dev/yr (Standard)<br>$1,599/dev/yr (Enterprise) | JavaScript, no native TypeScript | Feature-complete, mature, MS Project parity | Dated API, expensive, heavy bundle |
| **Bryntum Gantt** | Commercial | $850+/dev/yr | JavaScript, has framework wrappers | Modern UI, good React/Vue support | High price, sales-driven licensing model |
| **Highcharts Gantt** | Commercial (bundled with Highcharts) | Locked in the Highcharts license ($1,295+) | JavaScript | Charts ecosystem | Restrictive license, not Gantt-focused |

**Open Source:**

| Product | License | Stars | Stack | Status | Weaknesses |
|---|---|---|---|---|---|
| **DHTMLX Gantt Community Edition** | MIT | newly released (2026) | JavaScript, based on the dhtmlx PRO codebase | Maintained by DHTMLX — commercial backing | **Most dangerous competitor:** same MIT license as FluxGantt, ships a fair amount of PRO features (all dependency types, critical path, MS Project I/O). But: still JS, no native TypeScript; core not framework-agnostic; **heavy bundle** (inherits the PRO monolith architecture); dated API; no first-class React/Vue wrappers; no AI/MCP. The Community edition is a funnel strategy toward PRO — intentional feature gating |
| **Frappe Gantt** | MIT | ~12k GitHub | Vanilla JS, no TypeScript | Maintained but slow (~3 months/commit) | No resource view, no critical path, Finish-to-Start dependencies only, no MS Project import, no TypeScript, no framework wrapper, dated visuals |
| **jsGantt Improved** | BSD | — | jQuery | Legacy | jQuery-based, nearly abandoned, no modern framework support |

### 2.2 Market Gap

> **2026 update:** DHTMLX releasing a Community Edition (MIT) has closed part of the "MIT + feature-complete" gap FluxGantt originally targeted. "MIT-licensed" and "AI auto-schedule" are **no longer exclusive differentiators** — AI scheduling is now an industry standard (Asana, Monday, dhtmlx, Bryntum all have it or are adding it). The real remaining gap is about the **engineering quality of an embeddable library**, not about license or the mere existence of AI.

The remaining opportunity — where DHTMLX Community and Frappe are both weak — is an MIT library that delivers:

- **Genuinely small bundle** — "hello world" core <15kb gzip, full core <30kb gzip, tree-shakable. dhtmlx PRO/Community and Bryntum are all hundreds-of-KB monoliths. This is a measurable moat, hard to copy because it's tied to architecture.
- **TypeScript-first** with strict types + branded IDs (not just "ships .d.ts").
- **Framework-agnostic core** + first-class React/Vue/Svelte wrappers (DHTMLX Community has none).
- Full dependency types (FS, SS, FF, SF) with correct cascade + Critical Path (CPM).
- **Headless engine** that runs in Node/Workers (server-side scheduling, tests) — something dhtmlx's DOM-coupled architecture cannot do.
- **AI via MCP server** (Wave 3, see §3.2 & §9.3): instead of bolting AI onto the UI, expose the Gantt as a tool for an AI agent (Claude) to plan/adjust the schedule — same direction as FluxDocs. This is a different kind of AI integration, not "an AI button" like every competitor.

Resource view/leveling, MS Project XML I/O, and baselines remain in the Pro tier as before.

### 2.3 Customer Profile

**Primary Customer:**
- Solo/small-team developers building vertical SaaS
- Examples: construction management tools, video production planning, manufacturing schedulers, custom internal PM tools
- Pain point: dhtmlx pricing $599–1,599/dev/year, renewal anxiety, no migration path off the proprietary format
- Spend: $199–499 one-time/developer for a Pro license

**Secondary Customer:**
- Agencies and consultancies building custom tools for clients
- Pain point: client projects aren't big enough to justify a dhtmlx site license; building from scratch takes 2–3 months
- Spend: $499–999 team license, one-time

**Tertiary Customer (Cloud tier, post-launch):**
- Small PM teams wanting a hosted Gantt without the complexity of Asana/Monday
- Pain point: Asana/Monday have too many superfluous features; Excel is fragile
- Spend: $29–99/month/team

### 2.4 Total Addressable Market (TAM) Estimate

**Lower-bound estimate based on competitors' revenue signals:**

- dhtmlx Gantt customer count: ~5,000–10,000 developers (estimated)
- Bryntum: same order of magnitude
- Total commercial Gantt library market: ~$15–30M/year

**Feasible market share for FluxGantt:**

- Year 1: 50–100 Pro licenses × $299 = $15–30k
- Year 2: 300–500 Pro + 50 Cloud subs = $90–180k ARR
- Year 3: 1k+ Pro + 200 Cloud + early Enterprise = $300–500k ARR

---

## 3. Product Positioning & Branding

### 3.1 Brand Identity

| | |
|---|---|
| **Product Name** | FluxGantt |
| **Brand Family** | Flux (modern web tooling) |
| **Family Members** | FluxFiles (file manager, shipping)<br>FluxGantt (Gantt chart, this product)<br>FluxBoard (Kanban, future)<br>FluxData (spreadsheet, future)<br>FluxFlow (workflow editor, future) |

### 3.2 Tagline & Positioning

> **Tagline:** "The headless Gantt engine. <15kb. MIT."

> **Positioning:** "The TypeScript-first, headless Gantt chart library with the smallest bundle on the market — MIT-licensed, agent-ready via MCP."

> **Elevator Pitch:** "Every project management app needs a Gantt chart. The old options: pay $1,000/yr for dhtmlx PRO, use the MIT Community/Frappe builds that are heavy and not TypeScript, or burn three months building from scratch. FluxGantt is a headless, TypeScript-first engine with a <15kb gzip core (an order of magnitude smaller than dhtmlx/Bryntum), framework-agnostic with first-class React/Vue wrappers. And because it's a headless engine, it runs on the server too — enough for an AI agent like Claude to plan the schedule via MCP, not just an 'AI' button in the UI."

> **Positioning note:** AI auto-scheduling is now an **industry standard**, not an exclusive selling point. FluxGantt no longer markets itself as "the first MIT library with AI" (DHTMLX Community Edition is already MIT). The measurable differentiator is **architecture** — headless + small bundle + framework-agnostic + agent-native via an MCP server.

### 3.3 Brand Voice

| | |
|---|---|
| **Tone** | Direct, technical, confident but not arrogant |
| **Reference** | The docs voice of TanStack, Tiptap, Drizzle ORM |
| **Avoid** | Empty marketing: "revolutionary", "synergy", "next-gen" |
| **Prefer** | Concrete feature claims, benchmarks, code samples |

### 3.4 Visual Identity

| | |
|---|---|
| **Primary Color** | Indigo `#6366f1` — professional, calm, distinct from dhtmlx's blue |
| **Critical Color** | Red `#ef4444` — used only for the critical path |
| **Background** | Near-black `#0a0a0a` (dark mode), off-white `#fafafa` (light mode) |
| **Typography** | Inter (UI), JetBrains Mono (code samples) |
| **Logo Concept** | A horizontal bar with a cascading dependency arrow, stylized |

### 3.5 Domain & Online Presence

| | |
|---|---|
| **Primary domain** | fluxgantt.dev |
| **Secondary** | fluxgantt.com (redirect về .dev) |
| **NPM scope** | `@fluxgantt` |
| **GitHub** | github.com/fluxtoolkit/fluxgantt |
| **Twitter/X** | @fluxgantt |
| **Discord** | Flux Toolkit community server (shared with FluxFiles) |

---

## 4. Technology Stack

### 4.1 Core Engine

| Layer | Choice |
|---|---|
| **Language** | TypeScript 5.4+, strict mode |
| **Module format** | ESM-first, CJS fallback via tsup dual output |
| **Target** | ES2022 (modern browsers, Node 20+) |
| **Architecture** | Headless core (state + logic) decoupled from rendering |
| **State management** | Reactive store built on a hand-rolled signal, following Preact Signals semantics, zero dependency on React/Vue |
| **Rendering** | SVG primary (clean, vector, accessible, exportable); automatic Canvas fallback when task count > 2,000 |
| **Date arithmetic** | Temporal API via an internal adapter layer. Uses native `globalThis.Temporal` when the runtime provides it; `@js-temporal/polyfill` is an **optional peerDependency** (the consumer installs it when needed, NOT bundled into core → not counted against the bundle budget). `date-fns` only for minor ergonomics. Reason: Temporal handles timezone/DST correctly, native `Date` is not trustworthy |
| **Multiplayer** | Yjs (CRDT) — Pro/Cloud only. Reference: tldraw, BlockNote use Yjs successfully |
| **Build tooling** | tsup (library packages), vite (demo apps), changesets (versioning + changelog) |
| **Testing** | vitest (unit), playwright (e2e + visual regression), @testing-library (framework wrappers) |
| **Monorepo** | pnpm workspaces, turbo cho task orchestration |

### 4.2 Framework Wrappers

**Wave 1:**
- `@fluxgantt/react` — React 18+, hooks-first API
- `@fluxgantt/vue` — Vue 3+, Composition API

**Wave 2:**
- `@fluxgantt/svelte` — Svelte 5+, runes-based
- `@fluxgantt/angular` — Angular 17+, signals-based

**Community-driven:**
- `@fluxgantt/solid` — SolidJS
- `@fluxgantt/qwik` — Qwik
- `@fluxgantt/preact` — Preact (possibly trivial via React compat)

### 4.3 Cloud Backend (Wave 3)

| | |
|---|---|
| **Runtime** | Node.js 22 LTS |
| **Framework** | Hono (lightweight, Edge-ready) |
| **Database** | PostgreSQL 16 |
| **ORM** | Drizzle (type-safe migration, lightweight) |
| **Real-time sync** | Yjs + y-websocket |
| **Auth** | Better-Auth (modern, self-hostable, OAuth + email) |
| **Storage** | Cloudflare R2 (S3-compatible, cheap) |
| **CDN** | Cloudflare (free tier) |
| **Hosting** | Fly.io (primary) or Railway (alternative) |
| **Email** | Resend (transactional) |
| **Payments** | Stripe (Pro one-time + Cloud subscription) |
| **Analytics** | Plausible (privacy-first) |

### 4.4 Documentation Site

| | |
|---|---|
| **Framework** | Vocs (Vite-based, used by Wagmi) |
| **Hosting** | Vercel or Cloudflare Pages |
| **Search** | Built-in (handled by Vocs) |
| **Code examples** | StackBlitz embed, edit directly |

---

## 5. System Architecture

### 5.1 Layered Architecture

```
┌───────────────────────────────────────────────────────────┐
│  User Application Layer                                   │
│  (React, Vue, Svelte, Angular, vanilla JS)                │
└───────────────────────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────┐
│  Framework Wrapper Layer                                  │
│  @fluxgantt/react │ @fluxgantt/vue │ @fluxgantt/svelte    │
│  - Idiomatic component API per framework                  │
│  - Lifecycle integration                                  │
│  - Prop bindings type-safe                                │
└───────────────────────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────┐
│  Core Engine (@fluxgantt/core)                            │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐│
│  │  Public API: createGantt(), mount(), on()              ││
│  └───────────────────────────────────────────────────────┘│
│  ┌───────────────────────────────────────────────────────┐│
│  │  State Layer                                          ││
│  │  - TaskStore       (reactive task collection)          ││
│  │  - DependencyStore (links between tasks)               ││
│  │  - ResourceStore   (Pro: assignee, allocation)         ││
│  │  - BaselineStore   (Pro: plan snapshot)                ││
│  │  - ViewportStore   (zoom, scroll, selection)           ││
│  └───────────────────────────────────────────────────────┘│
│  ┌───────────────────────────────────────────────────────┐│
│  │  Compute Layer                                        ││
│  │  - Critical Path (CPM algorithm)                       ││
│  │  - Resource Leveling (Pro)                             ││
│  │  - Auto-Schedule (AI, Cloud tier)                      ││
│  │  - Working Calendar (working days, holidays)           ││
│  └───────────────────────────────────────────────────────┘│
│  ┌───────────────────────────────────────────────────────┐│
│  │  Render Layer                                         ││
│  │  - SVG renderer (primary, <2000 tasks)                ││
│  │  - Canvas renderer (fallback, ≥2000 tasks)             ││
│  │  - Switches automatically by task count                ││
│  └───────────────────────────────────────────────────────┘│
│  ┌───────────────────────────────────────────────────────┐│
│  │  Interaction Layer                                    ││
│  │  - Drag-resize task bar                                ││
│  │  - Drag-create dependency                              ││
│  │  - Keyboard navigation                                 ││
│  │  - Touch / mobile gesture                              ││
│  └───────────────────────────────────────────────────────┘│
│  ┌───────────────────────────────────────────────────────┐│
│  │  IO Layer                                             ││
│  │  - MS Project XML import/export (Pro)                  ││
│  │  - CSV / JSON                                          ││
│  │  - PNG / SVG / PDF export                              ││
│  └───────────────────────────────────────────────────────┘│
│  ┌───────────────────────────────────────────────────────┐│
│  │  Sync Layer (Cloud only)                               ││
│  │  - Yjs adapter                                         ││
│  │  - Presence (cursor, selection)                        ││
│  │  - Conflict resolution                                 ││
│  └───────────────────────────────────────────────────────┘│
└───────────────────────────────────────────────────────────┘
```

### 5.2 Design Principles

1. **Headless first** — the core engine is fully usable without rendering. State and compute can run server-side or in tests without a DOM.

2. **Reactive subscription, no full re-render** — consumers subscribe to a specific delta (task X moved, dependency Y added) instead of receiving a full state snapshot. This enables precise UI updates and good performance with 1000+ tasks.

3. **Plugin system for non-core features** — MS Project import, AI scheduling, and custom calendars are all plugins. Keep the core bundle under 30kb gzip.

4. **Tree-shakable everything** — import only the modules you use. A "hello world" Gantt that only renders tasks should be under 15kb gzip. The core (<30kb) / hello-world (<15kb) budget **excludes the Temporal polyfill** (optional peerDependency, see §4.1).

5. **Framework-agnostic core, opinionated wrappers** — the core has no opinion about the UI framework. Wrappers provide an idiomatic API per framework (hooks for React, composables for Vue, runes for Svelte, ...).

6. **Type safety end-to-end** — branded ID types prevent passing a `TaskId` where a `ResourceId` is expected. Strict null checks everywhere.

7. **Server-friendly** — the core runs in Node.js (or Workers) without a DOM. This enables server-side rendering, server-side validation, and headless tests.

---

## 6. Core Type System

### 6.1 Branded ID Types

```typescript
// Prevent mixing up ID types at compile time
type Brand<T, B> = T & { readonly __brand: B };

type TaskId       = Brand<string, 'TaskId'>;
type ResourceId   = Brand<string, 'ResourceId'>;
type DependencyId = Brand<string, 'DependencyId'>;
type BaselineId   = Brand<string, 'BaselineId'>;
type ProjectId    = Brand<string, 'ProjectId'>;
```

> **Coercion at the boundary:** the public API accepts a `string` for IDs (see the §7.1 example); the core brands them internally via the `toTaskId(s: string): TaskId` helper. Users do NOT write `as TaskId` themselves. Branded types only constrain the internals between core functions to avoid mixing `TaskId`/`ResourceId`.

### 6.2 Core Entity Types

```typescript
// Schedule instants accept several input shapes; normalized to Temporal internally
type DateInput = string | Date | Temporal.ZonedDateTime | Temporal.PlainDate;

type Task = {
  id:          TaskId;
  name:        string;
  start:       DateInput;          // ISO string | Date | Temporal; normalized to Temporal internally
  end:         DateInput;          // as above
  duration?:   number;             // working hours; derived from start/end when omitted
  progress:    number;             // 0..1
  priority?:   number;             // lower = higher priority; used by resource leveling (§13.2)
  parent?:     TaskId;             // parent in the hierarchy
  type:        'task' | 'summary' | 'milestone' | 'project';
  constraint?: TaskConstraint;
  resources?:  ResourceAssignment[];
  notes?:      string;
  color?:      string;             // overrides the default color
  meta?:       Record<string, unknown>;  // user's custom field
  createdAt:   Date;
  updatedAt:   Date;
};

type DependencyType =
  | 'FS'   // Finish-to-Start  (default; B starts after A finishes)
  | 'SS'   // Start-to-Start   (B starts when A starts)
  | 'FF'   // Finish-to-Finish (B finishes when A finishes)
  | 'SF';  // Start-to-Finish  (B finishes when A starts; rarely used)

type Dependency = {
  id:    DependencyId;
  from:  TaskId;
  to:    TaskId;
  type:  DependencyType;
  lag?:  number;        // hours; negative = lead time
};

type TaskConstraint =
  | { kind: 'asap' }                           // as soon as possible
  | { kind: 'alap' }                           // as late as possible
  | { kind: 'must-start-on'; date: DateInput }
  | { kind: 'must-finish-on'; date: DateInput }
  | { kind: 'start-no-earlier-than'; date: DateInput }
  | { kind: 'start-no-later-than'; date: DateInput }
  | { kind: 'finish-no-earlier-than'; date: DateInput }
  | { kind: 'finish-no-later-than'; date: DateInput };

type Resource = {
  id:           ResourceId;
  name:         string;
  type:         'person' | 'team' | 'equipment' | 'material';
  capacity:     number;          // working hours/day
  cost?:        { rate: number; currency: string };
  calendar?:    WorkingCalendar; // overrides the default working calendar
  color?:       string;
  avatar?:      string;
};

type ResourceAssignment = {
  resourceId:  ResourceId;
  units:       number;           // 0..1 = % allocation
};

type Baseline = {
  id:        BaselineId;
  name:      string;             // e.g. "v1.0 — Initial plan"
  capturedAt: Date;
  tasks:     Map<TaskId, { start: Date; end: Date; duration: number }>;
};

type WorkingCalendar = {
  workingDays:   ('mon'|'tue'|'wed'|'thu'|'fri'|'sat'|'sun')[];
  workingHours:  { start: string; end: string }[];   // e.g. "09:00"–"17:00"
  holidays:      DateInput[];
  timezone:      string;         // IANA timezone, e.g. "America/New_York"
};
```

### 6.3 Configuration Type

```typescript
type GanttConfig = {
  // Initial data
  tasks?:        Task[];
  dependencies?: Dependency[];
  resources?:    Resource[];      // Pro
  baselines?:    Baseline[];      // Pro

  // Display (all optional + have defaults; usually you only set viewMode)
  viewMode?:     'day' | 'week' | 'month' | 'quarter' | 'year';  // default 'week'
  density?:      'compact' | 'default' | 'comfortable';          // default 'default'
  theme?:        'light' | 'dark' | 'auto';                      // default 'auto'
  rtl?:          boolean;                                        // default false
  locale?:       string;          // default 'en'

  // Calendar
  calendar?:     WorkingCalendar;

  // Features (optional; default false unless noted)
  enableCriticalPath?:    boolean; // default false
  enableResourceView?:    boolean; // Pro, default false
  enableBaselines?:       boolean; // Pro, default false
  enableDependencyDrag?:  boolean; // default true
  enableKeyboardNav?:     boolean; // default true

  // Read-only
  readOnly?:     boolean;          // default false

  // Callback
  onTaskChange?:       (task: Task, prev: Task) => void;
  onDependencyChange?: (dep: Dependency) => void;
  onSelectionChange?:  (taskIds: TaskId[]) => void;
};
```

---

## 7. Public API Specification

### 7.1 Core Factory

```typescript
import { createGantt } from '@fluxgantt/core';

const gantt = createGantt({
  tasks: [
    { id: 'design', name: 'Design phase', start: '2026-01-01', end: '2026-01-15' },
    { id: 'build',  name: 'Build phase',  start: '2026-01-16', end: '2026-02-15' },
  ],
  dependencies: [
    { from: 'design', to: 'build', type: 'FS' },
  ],
  viewMode: 'week',
});

gantt.mount(document.getElementById('gantt-container'));
```

### 7.2 Task Operations

```typescript
gantt.addTask(task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Task
gantt.updateTask(id: TaskId, patch: Partial<Task>): Task
gantt.removeTask(id: TaskId): void
gantt.moveTask(id: TaskId, newStart: DateInput): Task
gantt.resizeTask(id: TaskId, newDuration: number): Task
gantt.setProgress(id: TaskId, progress: number): Task
gantt.getTask(id: TaskId): Task | undefined
gantt.getTasks(): Task[]
gantt.findTasks(predicate: (t: Task) => boolean): Task[]
```

> **Cascade:** `moveTask` / `resizeTask` / `updateTask` by default shift dependent tasks along their dependencies (FS/SS/FF/SF + lag) and respect `constraint`, emitting `task:moved` for every affected task. Disable via the `manual` scheduling mode.

### 7.3 Dependency Operations

```typescript
gantt.linkTasks(from: TaskId, to: TaskId, type?: DependencyType, lag?: number): Dependency
gantt.unlinkTasks(from: TaskId, to: TaskId): void
gantt.getDependencies(): Dependency[]
gantt.getDependenciesOf(taskId: TaskId): Dependency[]
```

### 7.4 Computation

```typescript
gantt.computeCriticalPath(): TaskId[]
gantt.computeResourceLeveling(): void              // Pro
gantt.autoSchedule(options?: AutoScheduleOptions): Promise<void>  // Cloud/AI
gantt.detectConflicts(): Conflict[]
```

### 7.5 Baselines (Pro)

```typescript
gantt.setBaseline(name: string): Baseline
gantt.compareBaseline(id: BaselineId): BaselineDiff
gantt.deleteBaseline(id: BaselineId): void
gantt.getBaselines(): Baseline[]
```

### 7.6 Viewport

```typescript
gantt.zoomTo(level: 'day' | 'week' | 'month' | 'quarter' | 'year'): void
gantt.scrollToTask(id: TaskId): void
gantt.scrollToDate(date: Date): void
gantt.setDensity(density: 'compact' | 'default' | 'comfortable'): void
gantt.setTheme(theme: 'light' | 'dark' | 'auto'): void
```

### 7.7 Selection

```typescript
gantt.select(id: TaskId | TaskId[]): void
gantt.selectAll(): void
gantt.deselect(): void
gantt.getSelection(): TaskId[]
```

### 7.8 IO

```typescript
gantt.importJson(data: object): void
gantt.importCsv(csv: string, mapping?: ColumnMapping): void
gantt.importMsproject(xml: string): void                       // Pro

gantt.exportJson(): object
gantt.exportCsv(columns?: string[]): string
gantt.exportPng(options?: ExportOptions): Promise<Blob>
gantt.exportSvg(options?: ExportOptions): string
gantt.exportPdf(options?: ExportOptions): Promise<Blob>
gantt.exportMsproject(): string                                 // Pro
```

### 7.9 Events

```typescript
gantt.on('task:added',          (task: Task) => void): UnsubscribeFn
gantt.on('task:moved',          (task: Task, prevStart: Date) => void)
gantt.on('task:resized',        (task: Task, prevDuration: number) => void)
gantt.on('task:removed',        (taskId: TaskId) => void)
gantt.on('task:progressed',     (task: Task, prevProgress: number) => void)
gantt.on('dependency:added',    (dep: Dependency) => void)
gantt.on('dependency:removed',  (depId: DependencyId) => void)
gantt.on('selection:changed',   (taskIds: TaskId[]) => void)
gantt.on('viewport:changed',    (state: ViewportState) => void)
gantt.on('critical-path:computed', (path: TaskId[]) => void)
gantt.on('baseline:saved',      (baseline: Baseline) => void)
gantt.on('conflict:detected',   (conflicts: Conflict[]) => void)
```

### 7.10 Lifecycle

```typescript
gantt.mount(container: HTMLElement): void
gantt.unmount(): void
gantt.destroy(): void
gantt.refresh(): void
```

### 7.11 React Wrapper Example

```tsx
import { FluxGantt, useFluxGantt } from '@fluxgantt/react';

function MyApp() {
  const { ref, addTask, computeCriticalPath } = useFluxGantt({
    tasks: initialTasks,
    onTaskChange: (task) => saveToBackend(task),
  });

  return (
    <div>
      <button onClick={() => addTask({ name: 'New task', start, end })}>
        Add Task
      </button>
      <FluxGantt ref={ref} viewMode="week" style={{ height: 600 }} />
    </div>
  );
}
```

### 7.12 Vue Wrapper Example

```vue
<script setup>
import { ref } from 'vue';
import { FluxGantt } from '@fluxgantt/vue';

const ganttRef = ref();
const tasks = ref(initialTasks);

const handleTaskChange = (task) => saveToBackend(task);
</script>

<template>
  <FluxGantt
    ref="ganttRef"
    :tasks="tasks"
    view-mode="week"
    @task-change="handleTaskChange"
    style="height: 600px"
  />
</template>
```

---

## 8. UI/UX Design System

### 8.1 Visual Philosophy

FluxGantt is a professional business tool. The aesthetic must convey "enterprise-grade software" while staying approachable. Deliberately avoid:

- Hand-drawn / sketchy style (Excalidraw-like)
- Playful illustration
- Heavy gradients or neumorphism
- Cartoon icons

Prefer:

- Clean geometric shapes
- Generous whitespace at comfortable density
- Dense information at compact density (for power users)
- Subtle shadows, not heavy
- System fonts and Inter for multi-language readability

### 8.2 Design Tokens

```css
:root {
  /* Typography */
  --fg-font-sans:        'Inter', 'Geist', system-ui, sans-serif;
  --fg-font-mono:        'JetBrains Mono', ui-monospace, monospace;
  --fg-font-size-xs:     11px;
  --fg-font-size-sm:     12px;
  --fg-font-size-base:   13px;
  --fg-font-size-lg:     14px;

  /* Density */
  --fg-row-height-compact:      24px;
  --fg-row-height-default:      32px;
  --fg-row-height-comfortable:  40px;

  /* Spacing */
  --fg-spacing-1:        4px;
  --fg-spacing-2:        8px;
  --fg-spacing-3:        12px;
  --fg-spacing-4:        16px;

  /* Light theme */
  --fg-bg:               #fafafa;
  --fg-bg-subtle:        #f3f4f6;
  --fg-fg:               #18181b;
  --fg-fg-muted:         #71717a;
  --fg-border:           #e5e7eb;
  --fg-border-strong:    #d4d4d8;

  /* Dark theme */
  --fg-bg-dark:          #0a0a0a;
  --fg-bg-subtle-dark:   #18181b;
  --fg-fg-dark:          #fafafa;
  --fg-fg-muted-dark:    #a1a1aa;
  --fg-border-dark:      #27272a;

  /* Task colors */
  --fg-task-default:        #6366f1;   /* indigo */
  --fg-task-default-hover:  #4f46e5;
  --fg-task-critical:       #ef4444;   /* red — critical path */
  --fg-task-completed:      #10b981;   /* emerald */
  --fg-task-baseline:       #94a3b8;   /* slate — plan baseline */
  --fg-task-milestone:      #f59e0b;   /* amber — diamond marker */

  /* Resource colors */
  --fg-resource-normal:     #10b981;
  --fg-resource-overload:   #fb923c;   /* orange — over-allocated */
  --fg-resource-critical:   #dc2626;   /* dark red — severely over-allocated */

  /* Grid */
  --fg-grid-line:           #e5e7eb;
  --fg-grid-line-strong:    #d4d4d8;
  --fg-grid-weekend:        #f9fafb;
  --fg-grid-today:          #fef3c7;
  --fg-grid-holiday:        #fee2e2;

  /* Dependencies */
  --fg-dep-line:            #64748b;
  --fg-dep-line-critical:   #dc2626;
  --fg-dep-arrow-size:      6px;

  /* Animations */
  --fg-transition-fast:     100ms ease-out;
  --fg-transition-default:  150ms ease-out;
}
```

### 8.3 Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Toolbar                                                         │
│  [Zoom -] [Day|Week|Month|Quarter|Year] [Zoom +]                 │
│  [Filter] [Baseline] [Export] [AI Assist]    [Search] [User]     │
├──────────────────────────────────────────────────────────────────┤
│                          │                                       │
│  Task list sidebar       │  Timeline canvas                      │
│  ┌─────────────────────┐ │  ┌───────────────────────────────┐    │
│  │ # │ Name │ Duration  │ │  │ M  T  W  T  F  S  S  M  T  W  │    │
│  ├─────────────────────┤ │  ├───────────────────────────────┤    │
│  │ 1 │ Phase 1   │ 14d  │ │  │████████░░░░░░░░░░░░░░░░░░░░    │
│  │ 1.1 Task A    │ 5d   │ │  │   ████░░░░░░░░░░░░░░░░░░░░     │
│  │ 1.2 Task B    │ 7d   │ │  │      ██████░░░░░░░░░░░░░░       │
│  │ 1.3 Milestone │ -    │ │  │            ◆                    │
│  │ 2 │ Phase 2   │ 21d  │ │  │              ░░░██████████░░    │
│  └─────────────────────┘ │  └───────────────────────────────┘    │
│                          │                                       │
├──────────────────────────────────────────────────────────────────┤
│  Detail panel (when a task is selected)                          │
│  Name: ...   Resource: ...   Progress: 50%   [Edit] [Delete]     │
└──────────────────────────────────────────────────────────────────┘
```

### 8.4 Interaction Patterns

**Direct manipulation:**

| Action | Result |
|---|---|
| Click + drag on the bar | Move the task |
| Click + drag the bar edge | Resize the task |
| Click + drag the handle | Create a dependency to another task |
| Double click the bar | Open detail edit |
| Right click | Open the context menu |

**Keyboard:**

| Key | Action |
|---|---|
| Arrow keys | Move the selection between tasks |
| Tab | Move between cells in the task list |
| Space | Select / deselect |
| Cmd/Ctrl + D | Duplicate task |
| Cmd/Ctrl + Z / Shift+Z | Undo / redo |
| Cmd/Ctrl + +/- | Zoom in / out |
| Delete | Delete the selected task |
| Enter | Inline-edit the selected task's name |

**Zoom:**

| Action | Result |
|---|---|
| Mouse wheel + Ctrl | Zoom in/out |
| Pinch gesture | Zoom on a touch device |

### 8.5 Accessibility

- Meets at least WCAG 2.1 AA
- Every interaction is keyboard-accessible
- ARIA labels for screen readers
- Colors tested for color blindness
- Critical path distinguishable without color (dashed outline)
- Focus indicator on every interactive element
- Respects `prefers-reduced-motion`
- **Canvas mode (≥2,000 tasks)** keeps a11y: a hidden (offscreen) DOM layer with an ARIA grid + focusable rows runs alongside the Canvas that draws the bars, so keyboard navigation and screen readers aren't lost when the renderer switches (see §5.1). WCAG AA applies to both renderers.

---

## 9. Feature Roadmap (3 Waves)

### 9.1 Wave 1 — Free MVP (Tier: Core MIT, Weeks 1–8)

**Goal:** Ship a solid MIT-licensed Gantt that beats Frappe Gantt **and DHTMLX Community Edition** on developer experience and **bundle size** (core <15kb gzip vs hundreds of KB for dhtmlx), enough to attract early users and GitHub stars. Since both MIT competitors are heavy / not TypeScript-first, "small-bundle headless engine + strict types" is the main selling angle of Wave 1 — not AI (which doesn't ship until later).

**Weeks 1–2: Foundation**
- Set up the monorepo (pnpm + turbo + changesets)
- Core package skeleton
- Task data model + TaskStore (reactive)
- Basic SVG timeline renderer
- Zoom levels: day / week / month / quarter / year
- Today line marker
- Light/dark theme switching

**Weeks 3–4: Interactions**
- Drag to move a task
- Drag the edge to resize
- Hierarchy (parent/child) with auto-rollup duration
- Click selection (single + multi with Shift/Ctrl)
- Keyboard navigation
- Working calendar (working days, holidays)

**Week 5: Dependencies & Critical Path**
- Dependencies: all 4 types (FS, SS, FF, SF)
- Lag/lead time support
- Arrow auto-routing between bars
- Drag handle to create a new dependency
- Critical path computation (CPM algorithm)
- Visual highlight for the critical path

**Week 6: Framework Wrappers**
- `@fluxgantt/react` with hooks
- `@fluxgantt/vue` with the Composition API
- Sample app per framework

**Week 7: Polish & Export**
- Export PNG / SVG
- Import/export JSON / CSV
- Milestone (diamond marker)
- Read-only mode
- Scaffold i18n (English-only at launch, structure ready to extend)
- Responsive mobile

**Week 8: Documentation & Launch Prep**
- Documentation site (Vocs)
- 10+ live examples on StackBlitz
- Landing page with 3 demo GIFs
- README with a quick start
- Comparison page (vs dhtmlx PRO, dhtmlx Community Edition, Bryntum, Frappe) — emphasizing the **bundle size** benchmark + TypeScript DX
- Draft the Show HN post
- Assets for Product Hunt

### 9.2 Wave 2 — Pro Tier (Weeks 11–18, after validation)

**Goal:** Add features developers will pay $199–499 one-time for.

**Weeks 11–12: MS Project Compatibility**
- Import MS Project XML (.xml format)
- Export MS Project XML
- Migration guide from dhtmlx
- Test with 20 real MS Project files

**Weeks 13–14: Resource View**
- Resource data model + ResourceStore
- Assign resources to tasks
- Resource workload chart (separate panel)
- Override a resource's calendar
- Visual warning on over-allocation
- Resource leveling algorithm

**Weeks 15–16: Baselines & Constraints**
- Capture a baseline (snapshot)
- Multi-baseline comparison
- Visual diff (planned vs actual)
- Task constraints (must-start-on, ASAP, ALAP, etc.)
- Custom columns in the task list
- Advanced filters

**Week 17: Advanced Export**
- Export PDF with a custom header/footer
- Print preview
- Multi-page export for large projects
- Remove watermark (Pro only)

**Week 18: Polish & Pro Launch**
- License key validation system
- Stripe Checkout integration (one-time payment)
- Pro documentation
- Pro tier landing page
- Email blast to the waitlist
- Public Pro launch

### 9.3 Wave 3 — Cloud + AI Tier (Month 6+)

**Goal:** Recurring revenue via a hosted multiplayer Gantt with AI features.

**Months 6–7: Cloud Foundation**
- Backend API (Hono + Postgres)
- User auth + organization model
- Project + workspace management
- Stripe subscription
- Cloud SDK package

**Months 8–9: Real-time Multiplayer**
- Yjs integration
- Presence (live cursors, selection indicators)
- Comments and @mentions per task
- Activity feed / audit log
- Share link with password and expiry

**Month 10–11: AI Features**

> AI auto-schedule is now an **industry standard** (every competitor has it) → no longer an exclusive selling point. FluxGantt's real differentiator is **how AI is integrated**: because the core is a headless engine that runs server-side, we expose the Gantt as a **tool for an AI agent** via MCP, instead of just bolting an "AI" button onto the UI like every competitor.

- **MCP server (`@fluxgantt/mcp`) — the main differentiator of the Cloud tier.** Exposes Gantt operations (add/move task, link dependency, compute critical path, level resources, query schedule) as MCP tools so Claude/an agent can plan and adjust the schedule conversationally. Same direction as FluxDocs. The headless engine makes this feasible where DOM-coupled libraries cannot.
- AI auto-schedule (LLM + constraint solver) — reaches parity with the industry, not marketed as exclusive
- AI conflict explanation
- AI risk forecaster (based on progress velocity)
- Natural-language task entry
- AI-generated postmortem when a project ends

**Month 12: Integrations**
- Webhooks (task changed, milestone reached)
- Slack notifications
- Email digest (weekly progress)
- Zapier connector
- Sync Jira / Linear / Asana

---

## 10. API Naming Conventions

### 10.1 Method Naming

Verb + noun, camelCase. Avoid generic "set"/"get" prefixes for actions; use them only for simple property access.

**Do:**
```typescript
gantt.addTask(task)
gantt.linkTasks(fromId, toId, 'FS')
gantt.computeCriticalPath()
gantt.exportPng()
gantt.zoomTo('week')
gantt.scrollToTask(taskId)
```

**Avoid:**
```typescript
gantt.task_add(task)                  // snake_case
gantt.createNewTaskInGantt(task)      // verbose
gantt.do('add', task)                 // generic action
gantt.set('zoom', 'week')             // generic setter
```

### 10.2 Event Naming

Past tense, namespaced with a colon, lowercase. Reads as "something happened".

```
task:added
task:moved
task:resized
task:removed
task:progressed
dependency:added
dependency:removed
resource:assigned
resource:unassigned
baseline:saved
selection:changed
viewport:changed
critical-path:computed
conflict:detected
```

### 10.3 CSS Class Naming (BEM)

Prefix every class with `fg-` to avoid clashing with the host application.

| Kind | Example |
|---|---|
| **Block** | `.fg-task` |
| **Element** | `.fg-task__bar`, `.fg-task__label` |
| **Modifier** | `.fg-task--critical`, `.fg-task--selected`, `.fg-task--milestone` |

```css
.fg-timeline { }
.fg-timeline__header { }
.fg-timeline__row { }
.fg-task { }
.fg-task__bar { }
.fg-task__progress { }
.fg-task--critical { }
.fg-task--milestone { }
.fg-dependency { }
.fg-dependency--fs { }
.fg-resource-panel { }
```

CSS custom property prefix: `--fg-*`

### 10.4 Type Naming

PascalCase, no "I" prefix (dated convention), a descriptive suffix only when needed.

**Do:**
```typescript
type Task = { ... }
type Dependency = { ... }
type DependencyType = 'FS' | 'SS' | 'FF' | 'SF'
type GanttConfig = { ... }
type GanttInstance = { ... }
type ResourceAssignment = { ... }
```

**Avoid:**
```typescript
interface ITask { ... }            // dated I prefix
type TaskType = { ... }            // redundant Type suffix
type taskConfig = { ... }          // wrong camelCase
```

**Branded ID:**
```typescript
type TaskId = string & { readonly __brand: 'TaskId' }
type ResourceId = string & { readonly __brand: 'ResourceId' }
```

### 10.5 File & Folder Naming

| Kind | Convention | Example |
|---|---|---|
| Files | kebab-case | `task-store.ts`, `critical-path.ts` |
| Folders | kebab-case | `store/`, `compute/`, `render/` |
| Tests | `*.test.ts` | `task-store.test.ts` |
| Types | `types.ts` | per package or feature folder |
| Index | `index.ts` | barrel export |

### 10.6 NPM Package Names

| Package | Description |
|---|---|
| `@fluxgantt/core` | Headless engine (Wave 1) |
| `@fluxgantt/react` | React wrapper (Wave 1) |
| `@fluxgantt/vue` | Vue wrapper (Wave 1) |
| `@fluxgantt/svelte` | Svelte wrapper (Wave 2) |
| `@fluxgantt/angular` | Angular wrapper (Wave 2) |
| `@fluxgantt/ai` | AI scheduling features (Pro) |
| `@fluxgantt/msproject` | MS Project import/export (Pro) |
| `@fluxgantt/cloud-sdk` | Cloud API client (Wave 3) |
| `@fluxgantt/themes` | Prebuilt themes (community) |
| `@fluxgantt/icons` | Icon set |
| `@fluxgantt/dev-tools` | Browser devtools extension |

---

## 11. Code Organization

### 11.1 Monorepo Structure

```
fluxgantt/
├── packages/
│   ├── core/                       # @fluxgantt/core
│   │   ├── src/
│   │   │   ├── gantt.ts            # Main entry: createGantt()
│   │   │   ├── store/
│   │   │   │   ├── task-store.ts
│   │   │   │   ├── dependency-store.ts
│   │   │   │   ├── resource-store.ts
│   │   │   │   ├── baseline-store.ts
│   │   │   │   ├── viewport-store.ts
│   │   │   │   └── index.ts
│   │   │   ├── compute/
│   │   │   │   ├── critical-path.ts
│   │   │   │   ├── resource-leveling.ts
│   │   │   │   ├── auto-schedule.ts
│   │   │   │   ├── working-calendar.ts
│   │   │   │   ├── duration.ts
│   │   │   │   └── cascade.ts
│   │   │   ├── render/
│   │   │   │   ├── timeline-svg.ts
│   │   │   │   ├── timeline-canvas.ts
│   │   │   │   ├── task-bar.ts
│   │   │   │   ├── task-list.ts
│   │   │   │   ├── dependency-line.ts
│   │   │   │   ├── milestone.ts
│   │   │   │   ├── grid.ts
│   │   │   │   ├── today-line.ts
│   │   │   │   └── renderer-base.ts
│   │   │   ├── interaction/
│   │   │   │   ├── drag-move.ts
│   │   │   │   ├── drag-resize.ts
│   │   │   │   ├── drag-create-dep.ts
│   │   │   │   ├── keyboard-nav.ts
│   │   │   │   ├── selection.ts
│   │   │   │   └── touch.ts
│   │   │   ├── io/
│   │   │   │   ├── json.ts
│   │   │   │   ├── csv.ts
│   │   │   │   ├── export-png.ts
│   │   │   │   ├── export-svg.ts
│   │   │   │   └── export-pdf.ts
│   │   │   ├── events.ts
│   │   │   ├── signals.ts           # Hand-rolled reactive primitive
│   │   │   ├── types.ts
│   │   │   ├── constants.ts
│   │   │   └── index.ts
│   │   ├── tests/
│   │   │   ├── unit/
│   │   │   ├── integration/
│   │   │   └── fixtures/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── tsup.config.ts
│   │
│   ├── react/                      # @fluxgantt/react
│   │   ├── src/
│   │   │   ├── FluxGantt.tsx
│   │   │   ├── use-flux-gantt.ts
│   │   │   ├── context.tsx
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── vue/                        # @fluxgantt/vue
│   │   ├── src/
│   │   │   ├── FluxGantt.vue
│   │   │   ├── useFluxGantt.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── svelte/                     # @fluxgantt/svelte (Wave 2)
│   ├── angular/                    # @fluxgantt/angular (Wave 2)
│   ├── ai/                         # @fluxgantt/ai (Pro)
│   ├── msproject/                  # @fluxgantt/msproject (Pro)
│   └── cloud-sdk/                  # @fluxgantt/cloud-sdk (Wave 3)
│
├── examples/
│   ├── react-vite-demo/
│   ├── vue-nuxt-demo/
│   ├── svelte-kit-demo/
│   ├── plain-html-demo/
│   ├── ms-project-import-demo/
│   ├── resource-leveling-demo/
│   └── ai-auto-schedule-demo/
│
├── apps/
│   ├── docs/                       # Documentation site (Vocs)
│   ├── landing/                    # Marketing landing page (Next.js or Astro)
│   └── playground/                 # Interactive playground (StackBlitz host)
│
├── tooling/
│   ├── eslint-config/
│   ├── tsconfig/
│   └── scripts/
│
├── .changeset/
├── docker-compose.dev.yml
├── pnpm-workspace.yaml
├── turbo.json
├── package.json
├── README.md
├── LICENSE                         # MIT (core)
├── CHANGELOG.md
└── CONTRIBUTING.md
```

---

## 12. Database Schema (Cloud Tier)

PostgreSQL schema for the hosted Cloud edition. Uses Drizzle ORM.

> **DB ↔ type mapping:** some columns are named differently from the public type fields (§6.2): `tasks.end_at` ↔ `Task.end`, `tasks.constraint_data` ↔ `Task.constraint`, `resources.cost_rate`/`cost_curr` ↔ `Resource.cost`. The mapping layer lives in `@fluxgantt/cloud-sdk`, so the naming difference never leaks into the public API.

```sql
-- Organizations (root multi-tenant)
CREATE TABLE organizations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(200) NOT NULL,
  slug            VARCHAR(100) UNIQUE NOT NULL,
  plan            VARCHAR(50) NOT NULL DEFAULT 'free',
  stripe_cust_id  VARCHAR(100),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Users
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           VARCHAR(320) UNIQUE NOT NULL,
  name            VARCHAR(200),
  avatar_url      TEXT,
  email_verified  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Membership (many-to-many user <-> org relationship)
CREATE TABLE memberships (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role        VARCHAR(50) NOT NULL,     -- 'owner', 'admin', 'editor', 'viewer'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, org_id)
);

-- Projects
CREATE TABLE projects (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name         VARCHAR(200) NOT NULL,
  description  TEXT,
  start_date   DATE,
  end_date     DATE,
  calendar     JSONB,                    -- WorkingCalendar
  settings     JSONB,                    -- override GanttConfig
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tasks
CREATE TABLE tasks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id   UUID REFERENCES tasks(id) ON DELETE CASCADE,
  name        VARCHAR(500) NOT NULL,
  start       TIMESTAMPTZ NOT NULL,
  end_at      TIMESTAMPTZ NOT NULL,
  duration    INT,                       -- in working hours
  progress    NUMERIC(3,2) DEFAULT 0,    -- 0.00 to 1.00
  type        VARCHAR(20) DEFAULT 'task',-- task/summary/milestone/project
  constraint_data JSONB,
  notes       TEXT,
  color       VARCHAR(20),
  meta        JSONB,                      -- user's custom field
  sort_order  INT,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_parent ON tasks(parent_id);
CREATE INDEX idx_tasks_dates ON tasks(project_id, start, end_at);

-- Dependencies
CREATE TABLE dependencies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_task   UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  to_task     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type        VARCHAR(2) NOT NULL,        -- FS/SS/FF/SF
  lag         INT DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dependencies_project ON dependencies(project_id);

-- Resources
CREATE TABLE resources (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        VARCHAR(200) NOT NULL,
  type        VARCHAR(50) NOT NULL,        -- person/team/equipment/material
  capacity    NUMERIC(5,2) DEFAULT 8.0,    -- hours/day
  cost_rate   NUMERIC(10,2),
  cost_curr   VARCHAR(3),
  calendar    JSONB,
  color       VARCHAR(20),
  avatar_url  TEXT,
  user_id     UUID REFERENCES users(id),   -- links to a user when type='person'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Resource assignments
CREATE TABLE resource_assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  resource_id   UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  units         NUMERIC(3,2) DEFAULT 1.0,  -- 0.00 to 1.00
  UNIQUE(task_id, resource_id)
);

-- Baselines
CREATE TABLE baselines (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name          VARCHAR(200) NOT NULL,
  snapshot      JSONB NOT NULL,             -- task state at capture time
  captured_by   UUID REFERENCES users(id),
  captured_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Comments
CREATE TABLE comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id),
  content     TEXT NOT NULL,
  mentions    UUID[],                      -- array of mentioned user IDs
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ
);

-- Activity log
CREATE TABLE activities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id),
  action      VARCHAR(50) NOT NULL,         -- task.created, task.moved, ...
  entity_type VARCHAR(50),                  -- task/dependency/resource/baseline
  entity_id   UUID,
  payload     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_activities_project_time ON activities(project_id, created_at DESC);

-- Share links
CREATE TABLE share_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  token           VARCHAR(64) UNIQUE NOT NULL,
  password_hash   VARCHAR(255),
  permission      VARCHAR(20) DEFAULT 'read',  -- read/comment/edit
  expires_at      TIMESTAMPTZ,
  view_count      INT DEFAULT 0,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- API keys (for webhook integration)
CREATE TABLE api_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        VARCHAR(200) NOT NULL,
  key_hash    VARCHAR(255) NOT NULL,
  prefix      VARCHAR(10) NOT NULL,         -- visible prefix for identification
  scopes      VARCHAR(100)[],
  last_used   TIMESTAMPTZ,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at  TIMESTAMPTZ
);
```

---

## 13. Algorithms Reference

### 13.1 Critical Path Method (CPM)

The critical path is the longest chain of dependent tasks, which determines the project's minimum duration. Tasks on the critical path have zero slack; any delay directly extends the project's end date.

**Pseudocode (simplified):**

```
function computeCriticalPath(tasks, dependencies):
    // 1. Topological sort the tasks by dependency order
    sorted = topologicalSort(tasks, dependencies)

    // 2. Forward pass: compute earliest start (ES) and earliest finish (EF)
    for task in sorted:
        predecessors = dependencies.where(d => d.to == task.id)
        if predecessors is empty:
            task.ES = task.start
        else:
            task.ES = max(pred.EF + pred.lag for pred in predecessors)
        task.EF = task.ES + task.duration

    // 3. Backward pass: compute latest start (LS) and latest finish (LF)
    projectEnd = max(task.EF for task in tasks)
    for task in reversed(sorted):
        successors = dependencies.where(d => d.from == task.id)
        if successors is empty:
            task.LF = projectEnd
        else:
            task.LF = min(succ.LS - succ.lag for succ in successors)
        task.LS = task.LF - task.duration

    // 4. Slack = LS - ES; critical path = tasks with slack == 0
    criticalPath = [task for task in tasks if task.LS - task.ES == 0]

    return criticalPath
```

**Edge cases to handle:**

- Cycle in the dependencies (detect, throw an error)
- Task with a constraint (overrides the computed ES/LF)
- Working calendar (skip non-working days)
- Lag/lead time (positive = wait, negative = overlap)

### 13.2 Resource Leveling

When a resource is over-allocated, shift tasks to resolve the conflict while still respecting dependencies and constraints.

**Approach (heuristic-based):**

```
function levelResources(tasks, dependencies, resources):
    while overAllocated(resources):
        conflict = findEarliestOverAllocation(resources)
        candidateTasks = tasksUsing(conflict.resource, conflict.timeWindow)

        // Sort by priority: lower priority first, then higher slack first
        candidateTasks.sortBy(t => [t.priority, -t.slack])

        for task in candidateTasks:
            if canDelayWithoutBreakingDependencies(task):
                delayTo(task, conflict.resource.nextAvailable)
                break
        else:
            // Cannot resolve without violating a constraint
            report(conflict)
            break

    recomputeCriticalPath()
```

### 13.3 AI Auto-Schedule (Cloud Tier)

Use an LLM to generate an initial schedule from a natural-language description, then refine it with a constraint solver.

```
function autoSchedule(naturalLanguageInput):
    // Stage 1: the LLM extracts tasks, dependencies, durations
    prompt = `Extract project plan from this description.
              Output JSON with tasks and dependencies.
              ${naturalLanguageInput}`

    structuredPlan = callLLM(prompt, model=config.aiModel)  // configurable model, not hardcoded

    // Stage 2: Apply the working calendar and resource constraints
    tasks = parseTasks(structuredPlan)
    dependencies = parseDependencies(structuredPlan)

    // Stage 3: Run topological sort + compute earliest start
    scheduledTasks = applyConstraints(tasks, dependencies, calendar, resources)

    // Stage 4: Validate, optimize the critical path
    if hasResourceConflicts(scheduledTasks):
        scheduledTasks = levelResources(scheduledTasks, dependencies, resources)

    return scheduledTasks
```

> **AI security:** separate `naturalLanguageInput` (untrusted) from the system prompt; **re-validate** `structuredPlan` against a schema before use; the AI only *suggests* (user reviews + reverts), never overwriting the plan automatically. Details: `.claude/rules/security.md`.

---

## 14. Pricing & Monetization

### 14.1 Tier Structure

| Tier | Price | Audience |
|---|---|---|
| **Core (MIT)** | $0 | OSS projects, evaluation, hobby |
| **Pro Self-host** | $299 one-time | Indie dev, agency (per developer license) |
| **Pro Team** | $999 one-time | Small dev team (up to 10 developers) |
| **Cloud Starter** | $29/month | Small team (Cloud, 5 users) |
| **Cloud Team** | $99/month | Growing company (25 users) |
| **Cloud Business** | $299/month | Mid-market (unlimited users) |
| **Enterprise** | $5k–50k/year | Large org (SSO, on-prem, SLA) |

### 14.2 Feature Matrix

| Feature | Core | Pro | Cloud | Ent |
|---|---|---|---|---|
| Task CRUD | ✓ | ✓ | ✓ | ✓ |
| Dependencies (FS/SS/FF/SF) | ✓ | ✓ | ✓ | ✓ |
| Critical path computation | ✓ | ✓ | ✓ | ✓ |
| React/Vue wrappers | ✓ | ✓ | ✓ | ✓ |
| Export PNG/SVG/JSON | ✓ | ✓ | ✓ | ✓ |
| Resource view | – | ✓ | ✓ | ✓ |
| Resource leveling | – | ✓ | ✓ | ✓ |
| Baselines | – | ✓ | ✓ | ✓ |
| Task constraints | – | ✓ | ✓ | ✓ |
| MS Project XML I/O | – | ✓ | ✓ | ✓ |
| Export PDF with branding | – | ✓ | ✓ | ✓ |
| Custom columns | – | ✓ | ✓ | ✓ |
| Svelte/Angular wrappers | – | ✓ | ✓ | ✓ |
| Remove watermark | – | ✓ | ✓ | ✓ |
| Email support | – | ✓ | ✓ | ✓ |
| Real-time multiplayer | – | – | ✓ | ✓ |
| Comment + @mention | – | – | ✓ | ✓ |
| Activity feed | – | – | ✓ | ✓ |
| AI auto-schedule | – | – | ✓ | ✓ |
| AI risk forecaster | – | – | ✓ | ✓ |
| Share link with permissions | – | – | ✓ | ✓ |
| Slack/Email integration | – | – | ✓ | ✓ |
| Webhooks | – | – | ✓ | ✓ |
| Priority support | – | – | ✓ | ✓ |
| SSO (SAML, OIDC) | – | – | – | ✓ |
| Audit log retention | – | – | – | ✓ |
| On-premise deployment | – | – | – | ✓ |
| DPA, SOC2, HIPAA BAA | – | – | – | ✓ |
| SLA 99.9% uptime | – | – | – | ✓ |
| Dedicated success manager | – | – | – | ✓ |

### 14.3 Why Pro Is One-Time

Developers prefer one-time license payments for libraries:

- A component library is infrastructure, not a workflow tool
- "Subscription fatigue" is real; developers limit recurring costs
- A one-time payment removes churn risk for us and reduces anxiety for the customer
- License keys are easy to validate and renew for lifetime updates
- One-time Stripe Checkout = simple integration, no subscription state needed

### 14.4 Why Cloud Is Recurring

The Cloud tier fits a subscription because:

- Hosting, bandwidth, and storage are ongoing costs
- Multiplayer needs a continuously running server
- AI features have per-call costs
- Customers expect uptime, updates, and support
- Recurring revenue funds ongoing development

---

## 15. Distribution & Launch Strategy

### 15.1 Pre-Launch (Weeks 7–8)

- Landing page live at fluxgantt.dev
- Prominent waitlist sign-up form
- 3 demo GIFs: drag task / dependency cascade / AI scheduling
- Sneak-peek tweet thread to the dev community
- Public GitHub repo with a polished README

### 15.2 Launch Day (Week 8)

A synchronized multi-channel launch:

- **Show HN post** (Tuesday, 8am PT is optimal):
  *"Show HN: FluxGantt — MIT-licensed Gantt chart library with AI scheduling"*

- **Product Hunt launch** (Tue–Thu): prepare maker comment, screenshots, gallery, video

- **Reddit posts:**
  - r/webdev (general)
  - r/javascript (technical)
  - r/reactjs (React community)
  - r/vuejs (Vue community)
  - r/SaaS (if targeting SaaS founders)

- **Dev.to article:**
  *"Why we built another Gantt library (and why it matters)"* — a long technical post explaining the market gap and architecture

- **Hashnode + Medium cross-post**

- **Email outreach** to 50 PM-tool startups: a personalized message like "Built an MIT Gantt alternative to dhtmlx with AI scheduling. Want a demo? Happy to help integrate if you're using Frappe or paying dhtmlx."

- **Twitter/X build-in-public thread:** daily progress GIFs before launch

### 15.3 Post-Launch (Ongoing)

**SEO content:**
- "FluxGantt vs dhtmlx Gantt" — target people migrating from dhtmlx
- "FluxGantt vs Bryntum" — target people migrating from Bryntum
- "FluxGantt vs Frappe Gantt" — target the upgrade path from free
- "How to add Gantt to Next.js" — SEO tutorial
- "Vue 3 Gantt chart tutorial" — SEO tutorial

**Discord community:** open after 100+ users. Shared with the FluxFiles community.

**Conference talks:** submit to React Conf, VueConf, JSConf with the talk *"Building a scheduling engine without VC funding"*.

**Open source contributions:** build wrappers for popular OSS PM tools (Plane, Vikunja) to integrate FluxGantt — instant distribution to their user base.

**YouTube channel:** tutorials + behind-the-scenes development.

---

## 16. 18-Week Execution Plan

| Week | Phase | Deliverable | Key metric |
|---|---|---|---|
| 1 | Build | Monorepo, core skeleton, task model, SVG renderer | Repo public, CI green |
| 2 | Build | Drag-resize, zoom levels, hierarchy | First working demo |
| 3 | Build | Dependencies (all 4 types), arrow routing | All dep types working |
| 4 | Build | Critical path, today line, working calendar | CPM verified against MS Project files |
| 5 | Build | React wrapper, `useFluxGantt` hook, sample app | npm publish alpha |
| 6 | Build | Vue wrapper, Composition API, sample app | Both wrappers stable |
| 7 | Polish | Export PNG/SVG, milestone, docs site, examples | Docs site live |
| 8 | **LAUNCH** | Show HN + Product Hunt + Reddit + email outreach | 500+ GH stars, 1k+ npm downloads |
| 9 | Listen | Bug fixes, review PRs, community engagement | Triage 80% of issues |
| 10 | Listen | Iterate on feedback, improve docs | DX polish, more examples |
| 11 | Pre-order | Email blast: "Pro early bird $199, first 100 spots" | 30–50 pre-orders |
| 12 | Build Pro | Import MS Project XML | Clean import of 20 sample .xml files |
| 13 | Build Pro | Resource view + assignment | Complete UI |
| 14 | Build Pro | Resource leveling algorithm | Algorithm validated |
| 15 | Build Pro | Capture + compare baselines | Visual diff working |
| 16 | Build Pro | Constraints, export PDF, custom columns | Export passes the Acrobat test |
| 17 | Polish | Pro docs, migration guide, license key system | License system working |
| 18 | **LAUNCH Pro** | Pro tier live, email pre-order customers | 50+ Pro licenses sold = $10k+ revenue |

---

## 17. Validation Milestones

### 17.1 Hard Gates (Go/No-Go Decisions)

**Sau Tuần 8 (Free MVP Launch):**

| Metric | Target | Nếu dưới target |
|---|---|---|
| GitHub stars (30 ngày) | 500+ | Audit lại distribution |
| npm weekly downloads | 1,000+ | DX cần cải thiện |
| Email waitlist signup | 200+ | Bỏ qua Pro launch |
| Active discussion (issue) | 20+ | Xây community |

**Action matrix:**

| Số metric pass | Hành động |
|---|---|
| 4/4 pass | Tiếp tục Wave 2 Pro tier như kế hoạch |
| 3/4 pass | Mở Pro pre-order với cap giảm (30 chỗ) |
| 2/4 pass | Trì hoãn Pro 4 tuần, ship Wave 1.5 (theo yêu cầu community) |
| 0–1/4 pass | Dừng kế hoạch monetization; re-evaluate positioning |

**Sau Tuần 18 (Pro Tier Launch):**

| Metric | Target | Nếu dưới target |
|---|---|---|
| Pro license bán được | 50+ | Reposition Pro |
| Tỷ lệ Pro → active usage | 60%+ | Cải thiện onboarding |
| Tỷ lệ refund | <5% | Xử lý chất lượng |
| Support ticket volume | <2/tuần | Cải thiện docs |

**Sau Tháng 6 (Quyết định Cloud Tier):**

Tín hiệu để tiến hành Cloud:
- 100+ khách Pro
- 10+ câu hỏi "có bản hosted không?"
- $5k+ MRR đủ cover infrastructure
- Ít nhất 1 inquiry Enterprise

Tín hiệu để trì hoãn Cloud:
- Thị trường Pro vẫn đang validate
- Capacity solo dev đang quá tải
- Không có budget infrastructure
- Không có demand rõ ràng từ khách non-dev

---

## 18. Risk Assessment & Mitigation

### 18.1 Technical Risks

**Risk:** SVG performance giảm với project lớn (bắt đầu rõ từ ~1.000 task)
**Mitigation:** Tự chuyển sang Canvas renderer khi vượt **ngưỡng chính thức 2.000 task** (thống nhất §4.1/§5.1). Dùng virtual scrolling. Benchmark liên tục để hiệu chỉnh ngưỡng.

**Risk:** Bug thuật toán critical path ở edge case (cycle, constraint)
**Mitigation:** Test suite mở rộng đối chiếu với output reference từ MS Project. Property-based testing với library fast-check.

**Risk:** Vấn đề tương thích MS Project XML
**Mitigation:** Test với 20+ file .xml thực tế từ nhiều version MSP khác nhau. Xây test fixture library do community góp.

**Risk:** Lỗi xử lý timezone (đặc biệt daylight saving)
**Mitigation:** Dùng Temporal API xử lý đúng vấn đề này. Tránh native `Date` cho mọi tính toán.

### 18.2 Market Risks

**Risk (⚠️ HAS OCCURRED — 2026):** dhtmlx released a **Community Edition (MIT)**, erasing the "MIT-licensed" advantage as a standalone selling point for FluxGantt.
**Mitigation (updated):** No longer competing on the "who is MIT" axis — both are MIT. Also do **not** rely on AI auto-schedule for defense (now an industry standard, and dhtmlx can add it). Shift the moat to **measurable architecture that dhtmlx struggles to copy because of monolith technical debt**:
- **Bundle size**: core <15kb gzip vs hundreds of KB for dhtmlx — publish the benchmark publicly and turn it into the main marketing story.
- **Genuine TypeScript-first + framework-agnostic core** + first-class React/Vue/Svelte wrappers (Community Edition has none).
- **Headless engine** running server-side → unlocks an **MCP server** (`@fluxgantt/mcp`) for AI agents — a qualitatively different AI integration, not an "AI button in the UI".
- Release velocity + a healthy community + DX (docs, types, StackBlitz examples) as developer-retention advantages.

**Risk:** Đối thủ được VC fund ra sản phẩm tương tự
**Mitigation:** Tốc độ và tập trung community. Solo + nhận diện brand Flux cho lợi thế 6–12 tháng đầu. Pivot sang niche nếu cần.

**Risk:** AI scheduling không ổn định trong production
**Mitigation:** Định vị AI là "suggest" không phải "decide". Luôn show reasoning. Cho phép revert dễ dàng. Test kỹ trước khi ship tầng Cloud.

**Risk:** Contributor open source fork và tạo sản phẩm cạnh tranh
**Mitigation:** Community lành mạnh + maintainer phản hồi nhanh giảm động lực fork. Tính năng Pro tier tạo moat commercial.

### 18.3 Execution Risks

**Risk:** Solo developer burnout trong sprint 18 tuần
**Mitigation:** Scope hàng tuần thực tế. Có buffer week. Build-in-public giảm cảm giác cô đơn. Nghỉ ngơi đầy đủ.

**Risk:** Pro launch conversion thấp
**Mitigation:** Free tier vẫn generous để giữ adoption. Email waitlist test demand trước khi xây. Validation gate ngăn over-investment.

**Risk:** Support volume vượt quá capacity solo
**Mitigation:** Docs đầy đủ giảm tải support. Forum community cho peer help. Support qua email only, không SLA, tới khi revenue đủ để hire.

**Risk:** Chi phí infrastructure Cloud tier vượt revenue
**Mitigation:** Charge công bằng từ đầu. Dùng Cloudflare R2 (storage rẻ), Fly.io (auto-scaling). Set hard limit theo tier.

### 18.4 Legal Risks

**Risk:** Tranh chấp license compliance (dùng commercial của MIT)
**Mitigation:** License term rõ ràng. FAQ về commercial use. Pro tier cung cấp EULA commercial-friendly cho ai muốn licensing rõ ràng.

**Risk:** Khiếu nại patent infringement (thuật toán scheduling)
**Mitigation:** CPM là public domain (phát triển từ 1957). Implementation clean-room. Tránh copy code hoặc API của dhtmlx nguyên văn.

**Risk:** Tuân thủ GDPR/privacy cho Cloud tier
**Mitigation:** Privacy-by-design từ đầu. Tùy chọn data residency cho Enterprise. Template DPA chuẩn sẵn sàng.

### 18.5 Security (Library & Cloud)

Threat model kỹ thuật (chi tiết & checklist đầy đủ trong `.claude/rules/security.md`). Vì FluxGantt là **library nhúng render dữ liệu untrusted**, lỗ hổng ở đây ảnh hưởng mọi app dùng nó.

**Library (Core/Pro) — chạy trong app khách:**
- **XSS qua render:** KHÔNG nội suy `task.name`/`notes`/`meta`/`color` vào SVG/DOM bằng `innerHTML`/template — dùng `textContent`/`setAttribute`. Validate `color` theo whitelist. Sanitize SVG khi export.
- **Parsing untrusted (JSON/CSV/XML):** validate schema trước khi nạp store. **XML (MS Project) phải tắt external entity/DTD → chống XXE**; giới hạn size/độ sâu chống DoS. CSV export chống formula injection. Phát hiện cycle dependency (throw).
- Tôn trọng CSP của host (không inline script/`eval`).

**Cloud (Wave 3):**
- **AuthZ multi-tenant:** mọi query scope `org_id`/`project_id` + kiểm `membership.role` ở server (chống IDOR).
- **Share link:** token ≥32 byte entropy; `password_hash` dùng argon2/bcrypt; tôn trọng `expires_at`/`permission`.
- **API key:** chỉ lưu `key_hash` + `prefix`; hỗ trợ `scopes`/`revoked_at`.
- SQL param hoá (Drizzle); webhook ký HMAC + chống SSRF; rate limit (đặc biệt endpoint AI tốn phí). Secret không hardcode/log; Stripe webhook verify signature.

**AI:** tách user input khỏi system prompt; validate output LLM bằng schema; AI *suggest* không *decide* (xem §13.3).

---

## 19. Appendix A: Sample Task JSON Schema

```json
{
  "id": "task-01ARZ3NDEKTSV4RRFFQ69G5FAV",
  "name": "Design phase",
  "start": "2026-01-01T09:00:00Z",
  "end": "2026-01-15T17:00:00Z",
  "duration": 80,
  "progress": 0.5,
  "parent": null,
  "type": "summary",
  "constraint": {
    "kind": "start-no-earlier-than",
    "date": "2026-01-01T00:00:00Z"
  },
  "resources": [
    {
      "resourceId": "res-01ARZ3NDEKTSV4RRFFQ69G5FAW",
      "units": 1.0
    }
  ],
  "notes": "Includes wireframing and prototyping",
  "color": "#6366f1",
  "meta": {
    "priority": "high",
    "department": "design",
    "external_id": "JIRA-1234"
  },
  "createdAt": "2026-01-01T08:00:00Z",
  "updatedAt": "2026-01-10T14:30:00Z"
}
```

**Ví dụ Dependency:**

```json
{
  "id": "dep-01ARZ3NDEKTSV4RRFFQ69G5FAX",
  "from": "task-01ARZ3NDEKTSV4RRFFQ69G5FAV",
  "to": "task-01ARZ3NDEKTSV4RRFFQ69G5FAY",
  "type": "FS",
  "lag": 0
}
```

**Project export bundle:**

```json
{
  "fluxgantt": {
    "schemaVersion": "1.0",
    "exported_at": "2026-06-20T10:00:00Z"
  },
  "project": {
    "id": "proj-...",
    "name": "Q1 Product Launch",
    "calendar": {
      "workingDays": ["mon", "tue", "wed", "thu", "fri"],
      "workingHours": [{"start": "09:00", "end": "17:00"}],
      "holidays": ["2026-01-01", "2026-12-25"],
      "timezone": "America/New_York"
    }
  },
  "tasks": [ "..." ],
  "dependencies": [ "..." ],
  "resources": [ "..." ],
  "baselines": [ "..." ]
}
```

---

## 20. Appendix B: Critical Path Algorithm Pseudocode

Outline đầy đủ cho reference implementation của thuật toán CPM.

```
function computeCriticalPath(
    tasks: Task[],
    dependencies: Dependency[],
    calendar: WorkingCalendar
): TaskId[] {

    // Step 1: Xây adjacency list
    successors: Map<TaskId, Dependency[]> = new Map()
    predecessors: Map<TaskId, Dependency[]> = new Map()

    for dep in dependencies:
        successors.get(dep.from).push(dep)
        predecessors.get(dep.to).push(dep)

    // Step 2: Topological sort (phát hiện cycle)
    sorted = topologicalSort(tasks, dependencies)
    if sorted == null:
        throw new Error("Cycle detected in dependencies")

    // Step 3: Forward pass — tính earliest start/finish
    es: Map<TaskId, Date> = new Map()
    ef: Map<TaskId, Date> = new Map()

    for task in sorted:
        preds = predecessors.get(task.id) || []

        // NOTE: nếu task.constraint (must-start-on / start-no-earlier-than / ASAP...) tồn tại
        //       → áp vào ES sau khi tính từ predecessors (constraint override).
        if preds.empty:
            es.set(task.id, task.start)          // hoặc projectStart nếu ASAP
        else:
            earliest = -Infinity
            for pred in preds:
                predTask = tasks.find(t => t.id == pred.from)
                candidate = earliestStartFromPred(predTask, task, es, ef, pred.type, pred.lag, calendar)
                earliest = max(earliest, candidate)
            es.set(task.id, earliest)

        ef.set(task.id, addWorkingHours(es.get(task.id), task.duration, calendar))

    // Step 4: Xác định project end
    projectEnd = max(ef.values())

    // Step 5: Backward pass — tính latest start/finish
    ls: Map<TaskId, Date> = new Map()
    lf: Map<TaskId, Date> = new Map()

    for task in reversed(sorted):
        succs = successors.get(task.id) || []

        if succs.empty:
            lf.set(task.id, projectEnd)
        else:
            latest = +Infinity
            for succ in succs:
                succTask = tasks.find(t => t.id == succ.to)
                succStart = computeStartConsideringType(succTask, ls, succ.type, succ.lag)
                latest = min(latest, succStart)
            lf.set(task.id, latest)

        ls.set(task.id, subtractWorkingHours(lf.get(task.id), task.duration, calendar))

    // Step 6: Critical path = task có zero slack
    criticalPath: TaskId[] = []

    for task in tasks:
        // slack = LS - ES ≥ 0; differenceInWorkingHours(from, to) dương khi `to` sau `from`,
        // nên tham số phải là (es, ls) — KHÔNG phải (ls, es) (sẽ ra dấu âm).
        slack = differenceInWorkingHours(es.get(task.id), ls.get(task.id), calendar)
        if slack == 0:
            criticalPath.push(task.id)

    return criticalPath
}

// Trả về earliest start cho `succ` do ràng buộc từ MỘT predecessor link.
// es/ef truyền tường minh (không dùng biến ngoài scope); FF/SF dùng succ.duration (không phải pred).
function earliestStartFromPred(
    pred: Task, succ: Task,
    es: Map<TaskId, Date>, ef: Map<TaskId, Date>,
    depType: DependencyType, lag: number,
    calendar: WorkingCalendar
): Date {
    switch depType:
        case 'FS': return addWorkingHours(ef.get(pred.id), lag, calendar)                  // succ.start ≥ pred.EF + lag
        case 'SS': return addWorkingHours(es.get(pred.id), lag, calendar)                  // succ.start ≥ pred.ES + lag
        case 'FF': return addWorkingHours(ef.get(pred.id), lag - succ.duration, calendar)  // succ.EF ≥ pred.EF + lag
        case 'SF': return addWorkingHours(es.get(pred.id), lag - succ.duration, calendar)  // succ.EF ≥ pred.ES + lag
}
```

---

## 21. Appendix C: Competitor Comparison Matrix

| Tính năng | FluxGantt | dhtmlx PRO | dhtmlx Community | Bryntum Gantt | Frappe Gantt | jsGantt Improved |
|---|---|---|---|---|---|---|
| License | MIT | Comm. | **MIT** | Comm. | MIT | BSD |
| Giá / dev / năm | $0 | $599+ | $0 | $850+ | $0 | $0 |
| **Bundle size (core, gzip)** | **<15kb** ✓ | heavy (monolith) | heavy (monolith) | heavy | ~ medium | ~ |
| TypeScript native | ✓ | ~ | ~ | ✓ | ✗ | ✗ |
| Core framework-agnostic | ✓ | ✗ | ✗ | ~ | ~ | ✗ |
| Headless / server-side | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| React wrapper | ✓ | ✓ | ~ | ✓ | ✗ | ✗ |
| Vue wrapper | ✓ | ✓ | ~ | ✓ | ✗ | ✗ |
| Svelte wrapper | ✓* | ✗ | ✗ | ✗ | ✗ | ✗ |
| Angular wrapper | ✓* | ✓ | ~ | ✓ | ✗ | ✗ |
| Đủ 4 loại dependency | ✓ | ✓ | ✓ | ✓ | ~ | ✗ |
| Critical path | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Resource view | ✓** | ✓ | ✗ | ✓ | ✗ | ✗ |
| Resource leveling | ✓** | ✓ | ✗ | ✓ | ✗ | ✗ |
| Baselines | ✓** | ✓ | ✗ | ✓ | ✗ | ✗ |
| MS Project XML import | ✓** | ✓ | ~ | ✓ | ✗ | ✗ |
| Export PDF | ✓** | ✓ | ✗ | ✓ | ~ | ✗ |
| AI auto-schedule † | ✓*** | ~ | ✗ | ~ | ✗ | ✗ |
| AI agent via MCP server | ✓*** | ✗ | ✗ | ✗ | ✗ | ✗ |
| AI risk forecaster | ✓*** | ✗ | ✗ | ✗ | ✗ | ✗ |
| Real-time multiplayer | ✓*** | ✗ | ✗ | ✗ | ✗ | ✗ |
| UI hiện đại (2026) | ✓ | ~ | ~ | ✓ | ~ | ✗ |
| Accessibility (WCAG AA) | ✓ | ~ | ~ | ✓ | ✗ | ✗ |
| Dark mode | ✓ | ~ | ~ | ✓ | ~ | ✗ |
| Maintained tích cực | ✓ | ✓ | ✓ | ✓ | ~ | ✗ |

**Chú thích:**
`✓` = Có · `✓*` = Có, Wave 2 (Pro tier) · `✓**` = Có, tầng Pro · `✓***` = Có, tầng Cloud · `✗` = Không · `~` = Một phần / hạn chế

`†` **AI auto-schedule is now an industry standard** — no longer an exclusive differentiator for FluxGantt. The real differentiators are **bundle size**, **headless/server-side**, **framework-agnostic core**, and **AI agent via MCP server** (the bold rows / FluxGantt-only). `dhtmlx Community` is derived from the PRO codebase as a funnel strategy: it ships some PRO features but **gates** resource/baseline/PDF to push users toward the paid build.

---

## Kết

Đây là bản spec living document. Khi sản phẩm phát triển, các phần sẽ được cập nhật, và thay đổi lớn sẽ phản ánh qua version number ở đầu tài liệu.

**Revision 0.1.2 (competitive response — DHTMLX Community Edition):** added DHTMLX Gantt Community Edition (MIT) to the competitor landscape, split from dhtmlx PRO (§2.1); rewrote the Market Gap now that "MIT" + "AI" are no longer exclusive selling points (§2.2); repositioned the tagline/pitch around measurable architecture — headless, <15kb bundle, agent-native via MCP (§3.2); reduced the weight of AI auto-schedule (now an industry standard) and added the **MCP server** (`@fluxgantt/mcp`) as the Cloud differentiator, same direction as FluxDocs (§9.1, §9.3); marked the "dhtmlx ships an MIT build" risk as **HAS OCCURRED** with a new architecture-moat mitigation (§18.2); added a DHTMLX Community column plus bundle-size/headless/MCP rows to the competitor matrix (§21).

**Revision 0.1.1 (review hoà giải mâu thuẫn):** Temporal là optional peerDependency không tính vào bundle budget (§4.1, §5.2); thêm `DateInput` + `Task.priority`, ID coercion ở boundary (§6); `GanttConfig` flags optional + default (§6.3); thống nhất API flat `exportPng`/`importJson` (§7.8); cascade behavior (§7.2); event `task:progressed` (§7.9, §10.2); a11y giữ ở chế độ Canvas (§8.5); ngưỡng renderer 2.000 (§18.1); mapping DB↔type (§12); AI model cấu hình được (§13.3); sửa lỗi scope `es` + `succ.duration` trong pseudocode CPM (§20); thêm §18.5 Security; export bundle dùng `schemaVersion`.

**Liên hệ:**

| | |
|---|---|
| GitHub | github.com/fluxtoolkit/fluxgantt |
| Email | hello@fluxgantt.dev |
| Twitter | @fluxgantt |
