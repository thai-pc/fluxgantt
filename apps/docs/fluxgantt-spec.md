# FluxGantt — Technical Specification

> **The Modern MIT-Licensed Gantt Chart Library**

| | |
|---|---|
| **Version** | 0.1.3 (Pre-launch Draft — revised) |
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

- **Genuinely small bundle** — measured, not asserted (`tooling/scripts/measure-competitor-bundles.mjs`, 2026-09): the headless engine is **7.50 KiB gzip**, an editable chart **18.40 KiB**, everything composed **23.16 KiB**, with zero required host CSS. `dhtmlx-gantt@10.0.3` (Community) is **226.18 KiB** gzip including its required stylesheet — so the "hundreds-of-KB monolith" framing holds for dhtmlx, and by reputation for Bryntum, whose real bundle is login-gated and therefore not independently measurable. **It does NOT hold for Frappe:** `frappe-gantt@1.2.2` is **14.89 KiB** gzip including CSS, *smaller* than FluxGantt's editable chart. Frappe is smaller because it has no critical path, no dependency types beyond FS, no working calendar and no types — so the honest claim is "you download only what you compose, and the engine alone is 7.71 KiB", not "we are the smallest". Overreaching here is uniquely expensive: a developer audience re-measures bundle claims in thirty seconds. The moat is architectural (subpath-split capabilities, `sideEffects: false`, CI-enforced budgets), which is the part that is hard to copy.
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

> **Tagline:** "The headless Gantt engine. 7.7kb. MIT."

> **Positioning:** "The TypeScript-first, headless Gantt chart library with the smallest bundle on the market — MIT-licensed, agent-ready via MCP."

> **Elevator Pitch:** "Every project management app needs a Gantt chart. The old options: pay $1,000/yr for dhtmlx PRO, use the MIT Community build that is 226kb gzip and not TypeScript, use Frappe and go without a critical path or types, or burn three months building from scratch. FluxGantt is a headless, TypeScript-first engine with a 7.7kb gzip core (an order of magnitude smaller than dhtmlx/Bryntum), framework-agnostic with first-class React/Vue wrappers. And because it's a headless engine, it runs on the server too — enough for an AI agent like Claude to plan the schedule via MCP, not just an 'AI' button in the UI."

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
| **Secondary** | fluxgantt.com (redirects to .dev) |
| **NPM scope** | `@fluxgantt` |
| **GitHub** | github.com/thai-pc/fluxgantt |
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
| **Hosting** | GitHub Pages (`.github/workflows/docs-deploy.yml`) — `renderStrategy: 'full-static'` under `basePath: '/fluxgantt'` |
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

3. **Plugin system for non-core features** — MS Project import, AI scheduling, and custom calendars are all plugins. Keep the fully-composed core bundle under 24kb gzip (measured 23.16 KiB, enforced via `pnpm size`).

4. **Tree-shakable everything** — import only the modules you use. Both budgets are met and CI-enforced as of the 2026-09 facade split: `createGantt()` alone is **7.50 KiB** gzip (budget 9 KiB) and every capability composed is **23.16 KiB** (budget 24 KiB) — see golden rule 5 in `CLAUDE.md` for the full seven-fixture table. Every budget **excludes the Temporal polyfill** (optional peerDependency, see §4.1).

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
  tasks?:        readonly TaskInput[];        // duplicate explicit ids throw at construction
  dependencies?: readonly DependencyInput[];  // Omit<Dependency, 'id'>; cycle/self/duplicate throws
  resources?:    Resource[];      // Pro — NOT in core's GanttConfig
  baselines?:    Baseline[];      // Pro — NOT in core's GanttConfig

  // Display (all optional + have defaults; usually you only set viewMode)
  viewMode?:     'day' | 'week' | 'month' | 'quarter' | 'year';  // default 'week'
  density?:      'compact' | 'default' | 'comfortable' | 'touch'; // default 'default'. 'touch'
                                  // (48px) is what withResponsive() picks under a coarse pointer;
                                  // never auto-selected without it. Runtime: setDensity() (§7.6)
  theme?:        'light' | 'dark' | 'auto';                      // default 'auto' — read only by
                                  // withTheme() (§7.6), inert without it
  canvasViewportHeight?: number;  // default 600 (px). Canvas mode only: bounds the <canvas>
                                  // backing store and the container's visible scroll height.
                                  // No SVG equivalent
  rtl?:          boolean;   // default false — DECLARED ONLY, NOT IMPLEMENTED, no wave assigned,
                            // and deliberately absent from GanttConfig: an inert public field
                            // is a promise. Text surfaces already get browser bidi for free;
                            // the unimplemented part is chart GEOMETRY (mirrored time axis,
                            // label column on the right).
  locale?:       string;          // default 'en' — construction-time only, no setLocale()
  ariaLabel?:    string;          // default 'Gantt chart' — accessible name of the chart, and
                                  // the <title> of every exported SVG/PNG
  messages?:     GanttMessages;   // i18n scaffold: host-supplied WHOLE-SENTENCE accessible-name
                                  // builders. English is the only language core ships; a
                                  // fragment table was rejected because the old suffix-append
                                  // shape (base + ', critical path' + ', selected') cannot be
                                  // reordered or inflected. Construction-time only.

  // Calendar & scheduling (all immutable for the life of the instance — no runtime setters)
  calendar?:     WorkingCalendar;  // default DEFAULT_CALENDAR (Mon–Fri 9–17 UTC)
  schedulingMode?: 'manual' | 'auto'; // default 'manual' (only the named task changes);
                                  // 'auto' cascades dependents later (§7.2)
  historyLimit?: number;          // default 100 undo entries, ring buffer; 0 = undo/redo inert.
                                  // Non-integer / negative throws at construction

  // Hierarchy
  initialCollapsed?: readonly TaskId[]; // collapsed at construction; unknown/leaf ids dropped
                                  // silently, no collapse:changed fired
  rollup?:       RollupProvider;  // pass computeRollup to DRAW parents at their rolled-up span.
                                  // A function, not a boolean: importing computeRollup into
                                  // /render cost ~400 B gzip in every render bundle and broke the
                                  // withRender + withInteraction budget. Derived on read, never
                                  // written back — getTasks/exportJson/undo/CPM see authored dates.
                                  // A rolled-up bar is not drag-movable or resizable

  // Features
  enableDependencyDrag?:  boolean; // default true. false: no connector handles, no
                                  // drag-create-dependency; move/resize stay, linkTasks()
                                  // unaffected. SVG only; readOnly wins. Construction-time only
  enableCriticalPath?:    boolean; // DROPPED, not in GanttConfig: the critical path is always
                                  // computed and painted (dashed outline + critical-path:computed).
                                  // The specified default (false) contradicted shipped,
                                  // a11y-relevant behaviour and flipping it would be breaking.
                                  // Headless: call computeCriticalPath(). If a 10k-task performance
                                  // case appears, add an additive opt-out then
  enableKeyboardNav?:     boolean; // DROPPED, not in GanttConfig: not applying withInteraction
                                  // already means "no interaction layer", and a switch for the
                                  // a11y baseline invites non-conformant deployments
  enableResourceView?:    boolean; // Pro — NOT in core's GanttConfig
  enableBaselines?:       boolean; // Pro — NOT in core's GanttConfig

  // Read-only
  readOnly?:     boolean;          // default false. Governs the rendered UI (no drag, no
                                  // keyboard Delete/undo/duplicate), not the method surface:
                                  // programmatic mutations still work

  // Callback
  onTaskChange?:       (task: Task, prev: Task) => void; // once per task-changing call
  onDependencyChange?: (dep: Dependency) => void;        // NOT SHIPPED — superseded by
                                  // on('dependency:added' | 'dependency:removed') (§7.9)
  onSelectionChange?:  (taskIds: TaskId[]) => void;      // NOT SHIPPED — superseded by
                                  // on('selection:changed') (§7.9)
};
```

The exported `GanttConfig` type is authoritative; the fields annotated DROPPED / NOT SHIPPED /
Pro above are absent from it on purpose. Every display field is construction-time except where the API adds a
setter (`zoomTo` on the base facade; `setDensity`, `setTheme` on their mixins).

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
gantt.addTask(task: TaskInput): Task   // Omit<Task, 'id' | 'createdAt' | 'updatedAt'> & { id?: TaskId }
gantt.updateTask(id: TaskId, patch: TaskPatch): Task   // Partial<Omit<Task, 'id' | 'createdAt' | 'updatedAt'>>
gantt.removeTask(id: TaskId): void     // removes descendants and their dependencies too
gantt.moveTask(id: TaskId, newStart: DateInput): Task
gantt.resizeTask(id: TaskId, newDuration: number): Task   // working hours
gantt.setProgress(id: TaskId, progress: number): Task     // 0..1
gantt.duplicateTask(taskId?: TaskId): Task[]
gantt.getTask(id: TaskId): Task | undefined
gantt.getTasks(): Task[]
gantt.findTasks(predicate: (t: Task) => boolean): Task[]
```

> **Cascade:** opt-in via `GanttConfig.schedulingMode: 'auto'`. The default is `'manual'`, which affects only the named task. In `'auto'`, `moveTask` / `resizeTask` / `updateTask` (when start/end/duration change) and a drag commit push dependent tasks **later** along FS/SS/FF/SF + lag (never earlier, duration-preserving), emitting `task:moved` for each and undoing as one step. `task.constraint` is **inert** in the cascade, as it is in CPM — the earlier "respects `constraint`" wording here never shipped.

**`duplicateTask(taskId?)`** copies one task, or the whole current selection when `taskId` is
omitted, through `addTask()` (so ids, timestamps, `task:added` and undo are the normal path).
Each copy gets a fresh id, keeps its `parent` (it lands as a sibling), starts where **its own**
source ends with the same working-hours span, resets `progress` to `0`, and copies every other
field verbatim. `name` gets no "(copy)" suffix, because a suffix is English-only text in an i18n'd library.
Children are not cloned, and copies carry **no** dependency edges (v1 does not rewire). One
call is one undo step. An unresolvable explicit `taskId` throws; an omitted `taskId` with an empty
selection is a no-op returning `[]`. The copies are not auto-selected. Bound to Cmd/Ctrl+D
(§8.4).

Every mutator throws after `destroy()` and none is gated by `readOnly`, which governs rendered
interactivity, not the method surface.

### 7.3 Dependency Operations

```typescript
gantt.linkTasks(from: TaskId, to: TaskId, type?: DependencyType, lag?: number): Dependency  // type default 'FS'; lag in working hours
gantt.unlinkTasks(from: TaskId, to: TaskId): void
gantt.getDependencies(): Dependency[]
gantt.getDependenciesOf(taskId: TaskId): Dependency[]
```

`linkTasks()` throws on a self-link, a duplicate pair or a cycle — rejected at write time rather
than discovered later by CPM. `GanttConfig.dependencies` goes through the same validation (a bad
initial set throws at construction) and takes no `id`. Both are undoable.

### 7.4 Computation

```typescript
gantt.computeCriticalPath(): CriticalPathResult   // { schedule, criticalTaskIds, projectEnd }
gantt.computeResourceLeveling(): void              // Pro
gantt.autoSchedule(options?: AutoScheduleOptions): Promise<void>  // Cloud/AI
```

`computeCriticalPath()` returns the full `CriticalPathResult` (per-task `TaskSchedule` with
ES/EF/LS/LF/slack, the ordered `criticalTaskIds`, `projectEnd`), not a bare `TaskId[]`; the
`critical-path:computed` event carries only the ids. It throws on an empty project and on a
cycle (`CyclicDependencyError`). A mounted chart recomputes it on every change and paints it
(dashed outline, not color-only) without being asked.

**Conflicts are an opt-in mixin**, for the same reason as theming below (class prototype methods
never tree-shake). Headless:

```typescript
import { withConflicts } from '@fluxgantt/core/conflicts';

const gantt = withConflicts(createGantt({ tasks, dependencies }), { kinds?: ConflictKind[] });
gantt.detectConflicts(): Conflict[]   // pure query, never emits; [] after destroy()

type Conflict =
  | { kind: 'dependency-violation'; dependencyId; from; to; dependencyType; lagHours;
      requiredStart: Temporal.ZonedDateTime; shortfallHours }
  | { kind: 'outside-parent'; taskId; parentId; edge: 'start' | 'end' | 'both' }
  | { kind: 'invalid-span'; taskId };            // end < start
```

The union is **open**: Pro adds resource and constraint kinds in minor releases, so consumers keep
a default branch. `conflict:detected` is a change notification, not a poll: its watcher runs only
while a listener is subscribed, does not fire on subscribe (seed with `detectConflicts()`), fires
only when the set changes (`[]` when it clears), and is emitted from a **microtask after** the
mutation's synchronous `task:*` / `dependency:*` / `history:changed` events — so a cascade or an
undo is announced once and never as a transient violation. **Rollup caveat:** `outside-parent` is
dropped automatically when `GanttConfig.rollup` is set (the parent is drawn at its derived span),
but `dependency-violation` keeps using a summary's **authored** dates, as the cascade does, so an
arrow that visibly runs backwards from or to a rolled-up summary may go unreported. The pure
`detectConflicts(tasks, dependencies, calendar, options?)` is exported from the main entry.

### 7.5 Baselines (Pro)

```typescript
gantt.setBaseline(name: string): Baseline
gantt.compareBaseline(id: BaselineId): BaselineDiff
gantt.deleteBaseline(id: BaselineId): void
gantt.getBaselines(): Baseline[]
```

### 7.6 Viewport

```typescript
// base — headless-safe, works before mount()
gantt.zoomTo(level: 'day' | 'week' | 'month' | 'quarter' | 'year'): void
gantt.zoomIn(): void           // one step toward 'day'; safe no-op at the boundary
gantt.zoomOut(): void          // one step toward 'year'
gantt.getViewMode(): ViewMode
```

When mounted, a zoom keeps the date at the viewport centre centred. No zoom is gated by `readOnly`
(zoom changes no data); `withInteraction` binds Cmd/Ctrl +/- and Ctrl+wheel.

**Scrolling and runtime density are an opt-in mixin** — scrolling needs a mounted DOM, and a
base-facade method would bill every headless consumer (the same reasoning as `withTheme` below):

```typescript
import { withViewport } from '@fluxgantt/core/viewport';

const gantt = withViewport(withRender(createGantt({ tasks })));
gantt.scrollToTask(id: TaskId, options?: {
  align?: 'nearest' | 'start' | 'center' | 'end';   // default 'nearest'
  behavior?: 'auto' | 'smooth';                      // default 'auto'
  expand?: boolean;                                  // default true: expand collapsed ancestors
}): boolean
gantt.scrollToDate(date: DateInput, options?: {
  align?: 'start' | 'center' | 'end';                // default 'center'
  behavior?: 'auto' | 'smooth';
}): boolean
gantt.setDensity(density: 'compact' | 'default' | 'comfortable' | 'touch'): void
```

Deviations from the original signatures, each deliberate:

- **`scrollToDate` takes `DateInput`**, not `Date` — the same input union as every other date in
  the API (golden rule 3: native `Date` only at the boundary).
- **An `options` argument** on both scroll methods (alignment, smooth scrolling — instant under
  `prefers-reduced-motion` — and whether `scrollToTask` may expand collapsed ancestors).
- **`boolean` returns.** `true` = the target exists and an offset was written (including "already
  visible"). `false` = not mounted (headless, or Canvas still loading: wait for
  `renderer:selected`), a hidden row with `expand: false`, or a date outside the chart's range.
  An unknown id or an invalid date throws. In SVG mode the container must itself be the scroll
  viewport (bounded height + `overflow: auto`); the return value cannot detect a container that
  does not scroll.
- **`'touch'`** is a fourth density (48 px rows) — the one `withResponsive()` selects under
  `(pointer: coarse)`. Calling `setDensity()` takes density ownership: `withResponsive` keeps
  adapting the label column and gestures but stops switching density.
- **`ViewportChangedPayload.density`**: `setDensity()` keeps the top visible row in place and
  emits `viewport:changed` `{ viewMode, density }`; `density` is present only on that path.
  Scrolling never emits `viewport:changed`.

Scrolling never moves focus or selection: the typical caller is a host search box, and stealing
its focus would be hostile. `select(id)` + `scrollToTask(id)` is the "go to and announce" recipe.
None of these is gated by `readOnly` or recorded as an undo step.

**Theming is an opt-in mixin, not a facade method.** `setTheme` was originally specified here as
`gantt.setTheme()`, but a base-facade method is billed to every consumer (class prototype methods
never tree-shake), and the `withRender + withInteraction` bundle had ~30 B of headroom when this
shipped. Golden rule 5 says change the shape rather than the budget, so theming lives on its own
subpath — the same move the facade split already made for IO/render/interaction:

```typescript
import { withTheme } from '@fluxgantt/core/theme';

const gantt = withTheme(withRender(createGantt({ tasks })));
gantt.setTheme(theme: 'light' | 'dark' | 'auto'): void
gantt.getTheme(): 'light' | 'dark' | 'auto'   // configured
gantt.getResolvedTheme(): 'light' | 'dark'    // painted ('auto' collapsed)
```

`GanttConfig.theme` (§7.1) seeds the initial value and is inert on an instance that never applies
`withTheme` — exactly as `density`/`locale` are inert without `withRender`. `'auto'` tracks
`prefers-color-scheme` live and unsubscribes on `destroy()`.

### 7.7 Selection

```typescript
gantt.select(id: TaskId | TaskId[]): void   // REPLACES the selection
gantt.selectAll(): void
gantt.deselect(): void
gantt.getSelection(): TaskId[]              // snapshot, not a live reference
```

Base facade, headless. Selection is **hierarchical**: selecting a parent selects every descendant,
and every method reports that flattened set, in insertion order (not row order). Unknown ids are
dropped silently. `selection:changed` fires once per call or completed click, only when the
flattened set actually changed. `getSelection()` returns `[]` after `destroy()`. Selection is
view state: not an undo step, not gated by `readOnly`, and cleared by an import. With
`withInteraction`, click / Shift+click / Cmd/Ctrl+click, Space and Shift+Arrow drive the same
store (§8.4); right-click does not select.

### 7.8 IO

IO is the opt-in `withIo()` mixin (`@fluxgantt/core/io`); the pure, instance-free functions are
exported from the same subpath.

```typescript
import { withIo } from '@fluxgantt/core/io';
const gantt = withIo(createGantt({ tasks }));

gantt.importJson(data: string | object, options?: { limits?: Partial<ImportLimits> }): ImportSummary
gantt.importCsv(csv: string, options?: { limits?: Partial<ImportLimits> }): ImportSummary

gantt.exportJson(options?: { timezone?: string }): ExportBundle                  // headless
gantt.exportCsv(options?: { timezone?: string; columns?: readonly CsvColumn[] }): string  // headless
gantt.exportSvg(options?: { inlineComputedStyle?: boolean }): string             // needs withRender + mount
gantt.exportPng(options?: { scale?: number; background?: string | 'transparent' }): Promise<Blob>

gantt.importMsproject(xml: string): void                       // Pro
gantt.exportMsproject(): string                                 // Pro
gantt.exportPdf(options?: ExportOptions): Promise<Blob>         // Pro (branding, §14.2) — not in core
```

- **Imports validate, then replace atomically.** The whole dataset is validated (and linked, so a
  cycle is caught) before any live store is touched; a rejected import leaves tasks, dependencies,
  history and selection unchanged. On success it replaces the dataset (no merge), clears undo/redo
  and the selection, and fires one `data:imported`. CSV has no dependencies, so `importCsv()`
  clears them. `ImportLimits` defaults: 50,000 tasks, 100,000 dependencies, hierarchy depth 100,
  20 M input chars (security.md: limit size).
- **`exportCsv()`** escapes formula-leading cells (`= + - @`, tab, CR) — security.md.
- **`exportSvg()`** returns a self-contained, sanitized SVG with resolved styles baked in
  (`inlineComputedStyle: false` keeps the `var(--fg-*)` declarations instead). Throws if not
  mounted.
- **`exportPng()`** rasterizes; it rejects (async) rather than throws. **SVG mode** caps the output
  at 8,192 px per side and 16.7 M px total — about 255 rows at default density and `scale` 1.

**Canvas-mode export (≥2,000 tasks).** Both exports cover the whole chart, not the visible window.

- `exportSvg()` rebuilds the chart as a **throwaway SVG** from what the canvas last painted and runs
  it through the same sanitizing pipeline. It stays synchronous, and blocks the main thread.
- `exportPng()` paints straight into a detached **offscreen canvas** with the Canvas renderer's own
  paint primitives, from a lazily loaded chunk (`io/export-canvas-png.ts`) that SVG-only consumers
  never download — no `<img>`, no blob URL, so none of the "exported SVG opened as HTML" surface.
  Output is bounded by the browser: 65,535 px per side, 2^27 px total area (half Chromium's
  ceiling), and a far lower measured area cap on WebKit. Because Chromium/WebKit fail an
  over-limit canvas by silently no-op'ing every draw, a **1x1 allocation probe** (paint one pixel,
  read its alpha back) runs first, so an oversize export rejects with an actionable error instead
  of returning a transparent PNG. Selection and focus are not exported; the critical path is.
- **`MAX_CANVAS_EXPORT_ROWS = 5,000` visible rows** (collapsed descendants do not count) for both.
  The originally proposed cap was 10,000; it was **lowered after measuring**: the SVG renderer is
  not virtualized, so the build dominates (~1 ms/row), and 10,000 rows blocked 4.1 s with native
  Temporal and 11.3 s with `@js-temporal/polyfill`, which most consumers still use. At 5,000 the
  block is ~2 s native / ~6 s polyfill, bounded rather than a hang — accepted for an explicit,
  user-triggered export — while ~2,700 rows (3 s) would leave almost no headroom over the
  2,000-task threshold. There is no per-call override in v1; collapsing rows exports a bigger plan
  under the cap.

### 7.9 Events

```typescript
gantt.on('task:added',          (task: Task, meta?: EventMeta) => void): UnsubscribeFn
gantt.on('task:moved',          (task: Task, prevStart: DateInput, meta?: EventMeta) => void)
gantt.on('task:resized',        (task: Task, prevDuration: number, meta?: EventMeta) => void)  // working hours
gantt.on('task:progressed',     (task: Task, prevProgress: number, meta?: EventMeta) => void)
gantt.on('task:removed',        (taskId: TaskId, meta?: EventMeta) => void)
gantt.on('dependency:added',    (dep: Dependency, meta?: EventMeta) => void)
gantt.on('dependency:removed',  (depId: DependencyId, meta?: EventMeta) => void)
gantt.on('critical-path:computed', (criticalTaskIds: readonly TaskId[]) => void)
gantt.on('selection:changed',   (taskIds: readonly TaskId[]) => void)
gantt.on('collapse:changed',    (collapsedTaskIds: readonly TaskId[]) => void)
gantt.on('history:changed',     (state: { canUndo: boolean; canRedo: boolean }) => void)
gantt.on('data:imported',       (summary: ImportSummary) => void)     // { format, taskCount, dependencyCount }
gantt.on('viewport:changed',    (state: ViewportChangedPayload) => void)  // { viewMode, density? }
gantt.on('renderer:selected',   (state: RendererSelectedPayload) => void) // { renderer, taskCount, canvasFallbackReason? }
gantt.on('conflict:detected',   (conflicts: readonly Conflict[]) => void)            // withConflicts
gantt.on('task:activated',      (payload: TaskActivatedPayload) => void)             // withEditHooks
gantt.on('task:context-requested', (payload: TaskContextRequestedPayload) => void)  // withEditHooks
// Pro: gantt.on('baseline:saved', (baseline: Baseline) => void) — not in core's GanttEventMap
```

The authoritative list is the exported `GanttEventMap` type. Conventions across the whole map:

- **Snapshot, not delta.** `selection:changed`, `collapse:changed` and `critical-path:computed`
  carry the complete set (selection in insertion order, not row order).
- **No-ops are suppressed** — reselecting the same set, `zoomTo()` the current mode, `undo()` on
  an empty stack emit nothing.
- **One fire per gesture.** `history:changed` fires once for a whole cascade-grouped drag; an
  import fires one `data:imported`, never `task:added` × N.
- `prevStart` is a `DateInput` (whatever shape the task was last written with), not a `Date`.
  `meta` (`{ source: 'undo' | 'redo' }`) is present only on events replayed by undo/redo, an
  additive third argument older two-parameter listeners ignore.
- `viewport:changed` fires on a view-mode change (and, with `density`, on `setDensity()`).
  Scrolling does not emit it.
- `renderer:selected` fires once per `mount()`, after paint. Above the Canvas threshold it is the
  only reliable "chart is now visible" signal; `canvasFallbackReason` is set only on a true
  Canvas→SVG fallback.
- `conflict:detected`, `task:activated` and `task:context-requested` fire only with their mixin
  applied (§7.4, §8.4).

### 7.10 Lifecycle, History & Hierarchy

```typescript
// withRender (@fluxgantt/core/render)
gantt.mount(container: HTMLElement): void   // remounts if already mounted
gantt.unmount(): void                       // keeps the instance
gantt.refresh(): void
// base
gantt.destroy(): void                       // unmount + clear listeners; idempotent
```

`mount()` picks the renderer once, by task count at that instant: SVG at ≤2,000 tasks
(synchronous), Canvas above (lazy chunk — the container is empty until `renderer:selected`
fires; any Canvas failure falls back to SVG). Every mixin must be applied **before the first
`mount()`**. After `destroy()` every mutating call throws; read-only getters (`getSelection`,
`canUndo`, `isCollapsed`, `getViewMode`, ...) return safe values instead.

**History (base):**

```typescript
gantt.undo(): boolean      // false = empty stack, a safe no-op (no event)
gantt.redo(): boolean
gantt.canUndo(): boolean
gantt.canRedo(): boolean
```

One entry per **logical gesture**, not per internal write: a cascade-grouped drag, a multi-select
Delete and a `duplicateTask()` that made eight copies each undo in one step. `history:changed`
`{ canUndo, canRedo }` fires once per committed gesture and per successful undo/redo, so buttons
wire off it instead of polling. Events replayed by undo/redo carry a third `meta` argument
`{ source: 'undo' | 'redo' }` so a persistence listener can skip them. `GanttConfig.historyLimit`
(default 100) bounds the stack as a ring buffer. An import clears both stacks and is not itself
undoable. Not gated by `readOnly`.

**Hierarchy (base, headless):**

```typescript
gantt.toggleCollapse(id: TaskId): void   // no-op on a leaf / unknown id
gantt.isCollapsed(id: TaskId): boolean   // collapsed AND still has children
gantt.collapseAll(): void
gantt.expandAll(): void
```

`collapse:changed` carries the full collapsed-id snapshot and fires only when the set changes;
`GanttConfig.initialCollapsed` seeds it silently. Collapse is view state: not an undo step, not
in `exportJson()`.

### 7.11 React Wrapper Example

`<FluxGantt>` wraps the lower-level `useFluxGantt(config)` hook, which returns `{ ref, instance }`
— the full instance, not a curated subset. Both compose `withRender` + `withInteraction` +
`withEditHooks` + `withViewport` for you (not `withIo`: the wrapper has no import/export
surface, so a consumer who never exports never downloads it), so the ref type is
`GanttInstance & RenderCapability & ViewportCapability`.

```tsx
import { useRef } from 'react';
import { FluxGantt, type FluxGanttRef } from '@fluxgantt/react';

function MyApp() {
  const gantt = useRef<FluxGanttRef>(null);

  return (
    <div>
      <button onClick={() => gantt.current?.addTask({ name: 'New task', start, end, progress: 0, type: 'task' })}>
        Add Task
      </button>
      <FluxGantt
        ref={gantt}
        tasks={initialTasks}
        viewMode="week"
        onTaskChange={(task) => saveToBackend(task)}
        onTaskActivated={({ taskId }) => openEditor(gantt.current!.getTask(taskId))}
        onTaskContextRequested={(p) => { p.preventDefault(); openMenu(p); }}
        style={{ height: 600, overflow: 'auto' }}
      />
    </div>
  );
}
```

Event props: `onTaskAdded`, `onTaskMoved`, `onTaskResized`, `onTaskProgressed`, `onTaskRemoved`,
`onDependencyAdded`, `onDependencyRemoved`, `onCriticalPathComputed`, `onTaskActivated`,
`onTaskContextRequested`, plus `GanttConfig.onTaskChange`. Callbacks stay reactive; config props
are **uncontrolled, construction-time only** — the instance is the source of truth after mount,
and a prop-driven `viewMode` change is a `key` remount (or `ref.zoomTo()`; density via
`ref.setDensity()`). The wrapper forwards `tasks`, `dependencies`, `calendar`, `viewMode`,
`density`, `locale`, `readOnly` and `enableDependencyDrag`; the other `GanttConfig` fields
(`ariaLabel`, `messages`, `theme`, `schedulingMode`, `historyLimit`, `initialCollapsed`, `rollup`,
`canvasViewportHeight`) type-check on the props but are **not forwarded yet** — a known gap. The
mount effect's cleanup calls `unmount()`, never `destroy()` (StrictMode safety).

### 7.12 Vue Wrapper Example

Same composition and the same exposed instance as React (`useFluxGantt` returns
`{ containerRef, instance }`). Props mirror the forwarded `GanttConfig` subset above; events are
kebab-case emits.

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { FluxGantt, type FluxGanttRef } from '@fluxgantt/vue';

const gantt = ref<FluxGanttRef>();
</script>

<template>
  <FluxGantt
    ref="gantt"
    :tasks="initialTasks"
    view-mode="week"
    :on-task-change="saveToBackend"
    @task-activated="({ taskId }) => openEditor(gantt?.getTask(taskId))"
    @task-context-requested="(p) => { p.preventDefault(); openMenu(p); }"
    style="height: 600px; overflow: auto"
  />
</template>
```

Emits: `task-added`, `task-moved`, `task-resized`, `task-progressed`, `task-removed`,
`dependency-added`, `dependency-removed`, `critical-path-computed`, `task-activated`,
`task-context-requested`. `onTaskChange` is a prop (it is a `GanttConfig` field, not a bus event).
Both wrappers forward events synchronously, so `payload.preventDefault()` works from a handler.

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
  --fg-row-height-touch:        48px;   /* Density 'touch' — set by withResponsive() under (pointer: coarse) */

  /* Spacing */
  --fg-spacing-1:        4px;
  --fg-spacing-2:        8px;
  --fg-spacing-3:        12px;
  --fg-spacing-4:        16px;

  /* Light theme */
  --fg-bg:               #fafafa;
  --fg-bg-subtle:        #f3f4f6;
  --fg-fg:               #18181b;
  --fg-fg-muted:         #6b6b73;
  --fg-border:           #e5e7eb;
  --fg-border-strong:    #d4d4d8;

  /* Dark theme — the PALETTE, not a switch. The renderers only ever read the base names
     above, so going dark means REDEFINING those base names with these values (plus dark
     grid/dependency values); nothing reads a `*-dark` token at paint time. `withTheme`
     (§7.6) does this by setting the base names as inline custom properties on the mount
     container, and light is simply the absence of those overrides. */
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
| Click + drag the handle | Create a dependency to another task (off with `enableDependencyDrag: false`) |
| Click / Shift+click / Cmd/Ctrl+click | Select / extend the range from the anchor / toggle one task. Clicking empty space clears the selection |
| Click the row's collapse glyph | Collapse / expand the subtree (live in `readOnly` charts too: it changes no data) |
| Double click the bar | Emits `task:activated` — **host-driven**, see below |
| Right click | Emits `task:context-requested` — **host-driven**, see below |

Drag gestures are SVG-only and off under `readOnly`; a Canvas chart (≥2,000 tasks) supports
click-select, collapse and the keyboard.

**Keyboard** (verified against `interaction/keyboard-nav.ts`; needs `withInteraction`):

| Key | Action |
|---|---|
| ArrowUp / ArrowDown | Move focus and the selection one row; with Shift, extend the range from the anchor. No wraparound |
| ArrowLeft / ArrowRight | Reserved for future cell navigation; not bound |
| Tab | Enters / leaves the chart. Rows use a roving tabindex (exactly one row is a tab stop); there are no cells to Tab between |
| Space | Toggle the focused task's selection |
| Cmd/Ctrl + D | Duplicate the selection (`duplicateTask()`); off under `readOnly` |
| Cmd/Ctrl + Z / Shift+Z | Undo / redo; off under `readOnly` |
| Cmd/Ctrl + +/- | Zoom in / out (also Ctrl+wheel); live under `readOnly` |
| Delete / Backspace | Delete the selection; off under `readOnly` |
| Enter | Summary row: collapse / expand. Leaf row: emits `task:activated` (with `withEditHooks`) |
| F2 | Emits `task:activated` on any row (with `withEditHooks`) |
| ContextMenu / Shift+F10 | Emits `task:context-requested` (with `withEditHooks`) |

**Host-driven editing** (opt-in `withEditHooks()` from `@fluxgantt/core/edit-hooks`): the spec
originally had double-click open a detail editor, right-click open a context menu and Enter
inline-edit the name. Core ships none of that UI. It **emits**, and the host builds the editor
and menu with its own components, i18n and permissions — a library-owned editor would be wrong
for most hosts, and every byte of it would be billed to the ones that replace it.

| Gesture | Event |
|---|---|
| Double-click; Enter on a leaf row; F2 on any row | `task:activated` `{ taskId, part, source: 'pointer' \| 'keyboard', clientX, clientY }` |
| Right-click; ContextMenu key; Shift+F10; touch long-press (500 ms, `longPressMs`) | `task:context-requested` `{ taskId, part, source: 'pointer' \| 'keyboard' \| 'long-press', clientX, clientY, preventDefault() }` |

- **`readOnly` charts still emit both.** They mean "the user asked to open this task", not "the
  task is editable"; a read-only detail card is a normal use.
- **`preventDefault()`** suppresses the native context menu only when called synchronously in the
  listener. No listener, or a listener that does not call it, leaves the browser menu alone —
  the wrappers subscribe to every event, so "a listener exists" cannot mean "suppress".
- **iOS** fires no `contextmenu`, so `preventDefault()` cannot stop its callout or loupe; the host
  adds `-webkit-touch-callout: none; user-select: none` (core ships no CSS for it).
- A long-press that fires ends the pointer gesture: no drag, resize, link or select follows.
- **`part`** is `'bar' | 'label' | 'row'`; keyboard gestures always report `'row'`, and **Canvas
  never reports `'bar'`** (its hit-test is row-wide). Right-click does not select.
- Keyboard access to every row needs `withInteraction` (arrow keys, roving focus); without it
  rows 2..n are pointer-only.

**Zoom:**

| Action | Result |
|---|---|
| Mouse wheel + Ctrl | Zoom in/out |
| Pinch gesture | Zoom on a touch device, with `withResponsive()` (see below) |

**Touch gesture arbitration** (implemented by `withResponsive()` from `@fluxgantt/core/responsive`):

Every gesture in the library is built on Pointer Events, so touch works without a separate touch
layer. What does not work without help is arbitration against the browser's own scroll gesture: a
finger on a task bar scrolls the container, the browser fires `pointercancel`, and the drag dies
before it reaches its threshold.

`touch-action` alone cannot fix this. It is not honoured on SVG child elements (they establish no
CSS box), so scoping it to `.fg-task__bar` silently does nothing — it must go on the root `<svg>`;
and the browser latches its value at hit-test time, so it cannot be toggled reactively inside
`pointerdown`. A blanket `touch-action: none` on the root would kill scrolling, which on a phone
is the primary interaction.

The contract is therefore:

| Where the `pointerdown` lands | Owner |
|---|---|
| Inside `.fg-task[data-task-id]` | `interaction/` — drag-move, drag-resize, drag-create-dep, unchanged |
| Anywhere else in the chart (grid, header, label column, empty space) | `responsive/` — pans by writing `scrollLeft`/`scrollTop` |

Consequences, both documented for hosts: native pinch-zoom is suppressed while a finger is on the
chart, and momentum/inertial scrolling is replaced by a direct scroll write. Chart-level
pinch-to-zoom lands in this same recognizer: two touch pointers down on the chart are a pinch
(`pinchZoom: false` opts out). Each pinch past 1.4x (spread) or 0.7x (squeeze) of the last
baseline steps one view mode through `zoomIn()`/`zoomOut()`, anchored so the date under the
fingers' midpoint stays under it, and landing the second finger cancels any pan, bar drag,
resize, dependency link or long-press the first finger started. A pinch with both fingers on the
sticky header band is left to the browser (the band keeps `touch-action: auto`). WCAG 2.5.1
(Pointer Gestures): the library ships no single-pointer zoom control (keyboard shortcuts and
Ctrl+wheel are not one for a touch user), so a host that keeps pinch enabled on touch must provide
one, e.g. buttons calling `zoomIn()` / `zoomOut()`.

Coarse-pointer target sizes are **24x24 CSS px** — WCAG 2.2 SC 2.5.8 *Target Size (Minimum)*, at
Level AA. SC 2.5.5's 44x44 is Level AAA and is deliberately not the bar here: a 44px circular link
handle needs `r: 22`, large enough to swallow the bar it anchors to.

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

**Goal:** Ship a solid MIT-licensed Gantt that beats Frappe Gantt **and DHTMLX Community Edition** on developer experience and **bundle size** (7.50 KiB gzip headless / 18.40 KiB editable, against 226 KiB for dhtmlx Community — though note Frappe measures *smaller* at 14.89 KiB, see §2.2), enough to attract early users and GitHub stars. Since both MIT competitors are heavy / not TypeScript-first, "small-bundle headless engine + strict types" is the main selling angle of Wave 1 — not AI (which doesn't ship until later).

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
- ~~Scaffold i18n (English-only at launch, structure ready to extend)~~ ✅ `GanttConfig.messages`/`ariaLabel`
- ~~Responsive mobile~~ ✅ `withResponsive()` on `@fluxgantt/core/responsive`

**Week 8: Documentation & Launch Prep**
- ~~Documentation site (Vocs)~~ ✅ `apps/docs`, 19 pages
- ~~10+ live examples on StackBlitz~~ ⚠️ **partial** — 9 examples exist and are catalogued at `/docs/examples`. They become **4 StackBlitz projects** (vanilla with its six pages, React, Vue, headless) once the first release after 2026-10 runs `.github/workflows/stackblitz-examples.yml`, which generates standalone copies of the examples against the just-published npm versions (`tooling/scripts/build-stackblitz-examples.mjs`) and force-pushes them to the `stackblitz` branch; the docs and README already link `stackblitz.com/github/thai-pc/fluxgantt/tree/stackblitz/<dir>` and return 404 until then. The in-repo examples stay on `workspace:*`. 10+ is still open: the remaining examples are the Pro/Cloud demos (`svelte-kit`, `vue-nuxt`, `ms-project-import`, `resource-leveling`, `ai-auto-schedule`), which are Wave 2/3 by definition.
- ~~Landing page~~ ✅ — it is `apps/docs/pages/index.mdx`, served at the site root. **`apps/landing/` stays empty deliberately** (see its README): a second marketing app would duplicate the measured bundle-size and comparison numbers and drift out of sync. Revisit when Pro pricing/checkout ships (§9.2).
- ⚠️ **3 demo GIFs — not produced.** Binary media captured from a running browser; cannot be authored in-repo. Specified shot-by-shot in `apps/docs/launch/product-hunt.md`. Note that §15.1's third GIF ("AI scheduling") is replaced by a critical-path recompute, since AI scheduling is Wave 3 and does not exist.
- ~~README with a quick start~~ ✅ — plus a measured bundle-size table and a competitor comparison.
- ~~Comparison page (vs dhtmlx PRO, dhtmlx Community Edition, Bryntum, Frappe) — emphasizing the **bundle size** benchmark + TypeScript DX~~ ✅ `/docs/comparison`, built on reproducible measurement via `tooling/scripts/measure-competitor-bundles.mjs`. **Two corrections to this spec's own claims came out of measuring rather than asserting:** (a) §2.2/§9.1's "all competitors are hundreds-of-KB monoliths" is **false for Frappe** — `frappe-gantt@1.2.2` is 14.89 KiB gzip including CSS, *smaller* than FluxGantt's 18.40 KiB editable chart. The comparison page states that outright, because a developer audience verifies bundle claims in thirty seconds and an overreach would cost more credibility than the row costs. (b) **Bryntum is unmeasurable**: `@bryntum/gantt` on npm is a 13 KB placeholder and the real bundle is login-gated, so the page leaves that cell empty instead of quoting a marketing figure. The defensible framing is not "we are smallest" but "the headless engine is 7.50 KiB and you download only what you compose".
- ~~Draft the Show HN post~~ ✅ `apps/docs/launch/show-hn.md`. Title/body/prepared replies. **Deliberately does not use §15.2's suggested "…with AI scheduling" phrasing** — Wave 3 vapourware on the one post where credibility decides the outcome, and §2.2 already concluded AI is no longer a differentiator.
- ~~Assets for Product Hunt~~ ⚠️ **text complete, images not** — `apps/docs/launch/product-hunt.md` has the tagline, description, maker comment and prepared replies; the gallery, thumbnail, GIFs and video are specified (viewport sizes, which example page, what to record) but are binary media that must be captured.

**Gating all of the above:** Show HN and Product Hunt both require `@fluxgantt/core` published to npm and the docs site deployed at a public URL. A launch pointing at an uninstallable package converts nothing. **The npm half is done**: the `@fluxgantt` org was claimed and `core@0.2.0` / `react@0.1.1` / `vue@0.1.1` published on 2026-09-24 via `.github/workflows/release.yml` (changesets: merge to `master` opens a "Version Packages" PR; merging that PR publishes). **The docs half is not**: `.github/workflows/docs-deploy.yml` exists but Pages is still disabled on the repo, so the site has never been deployed and the packages' own `homepage` links are dead. One owner action remains — Settings → Pages → Source = GitHub Actions, then dispatch **Deploy docs** once. See `RELEASING.md`.

**Wave 1 API gap closure (`core@0.3.0`, `react@0.2.0`, `vue@0.2.0`):** a gap review of §7 against the shipped facade found Core APIs that were specified but missing. They landed as three new opt-in subpaths rather than base-facade methods (class prototype methods never tree-shake): `@fluxgantt/core/viewport` (`withViewport`: `scrollToTask`, `scrollToDate`, runtime `setDensity`, §7.6), `@fluxgantt/core/conflicts` (`withConflicts`: `detectConflicts` + `conflict:detected`, §7.4) and `@fluxgantt/core/edit-hooks` (`withEditHooks`: `task:activated` / `task:context-requested`, §8.4). The same release made `exportSvg()`/`exportPng()` work in Canvas mode (§7.8), added `GanttConfig.enableDependencyDrag` (§6.3), and gave the wrappers the edit-hook props/emits and `withViewport` (§7.11/§7.12). Each new subpath got its own size fixture (`with-viewport` and `with-edit-hooks` at 16 KiB, `with-conflicts` at 10 KiB) and **no existing budget was raised**: hello world was 7.60 KiB / 9 KiB and the kitchen sink 23.99 KiB / 24 KiB at release (since trimmed to 7.50 KiB and 23.16 KiB by the 2026-10 headroom pass, see CLAUDE.md golden rule 5); the kitchen sink deliberately excludes `withViewport` and `withConflicts` for lack of headroom, exactly as it excludes `withTheme`.

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
│   │   │   │   └── selection.ts
│   │   │   ├── responsive/         # Touch/viewport adaptation — NOT interaction/, see note
│   │   │   │   └── mixin.ts
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

> **Why `responsive/` and not `interaction/touch.ts`** (the file this tree named until the
> capability shipped): nothing in it is a gesture recognizer registered with the
> `interaction/pointer-drag.ts` coordinator. It is a *viewport adaptation* layer that writes a
> stylesheet, pushes renderer options, owns a `ResizeObserver`, and — only as a consequence of
> having to claim `touch-action` — implements panning. Putting it in `interaction/` would also
> have billed every `withInteraction()` consumer for it; as its own opt-in subpath it costs
> non-touch charts zero bytes. Touch *gestures* proper need no dedicated module: every recognizer
> in `interaction/` is built on Pointer Events and already works with a finger.

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
- 3 demo GIFs: drag task / dependency cascade / **critical-path recompute** — *originally "AI scheduling", changed because that is Wave 3 and does not exist; a GIF of it would be a fabrication. Shot-by-shot capture spec in `apps/docs/launch/product-hunt.md`.*
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

**After Week 8 (Free MVP Launch):**

| Metric | Target | If below target |
|---|---|---|
| GitHub stars (30 days) | 500+ | Re-audit distribution |
| npm weekly downloads | 1,000+ | DX needs improvement |
| Email waitlist signups | 200+ | Skip the Pro launch |
| Active discussion (issues) | 20+ | Build community |

**Action matrix:**

| Metrics passed | Action |
|---|---|
| 4/4 pass | Continue with the Wave 2 Pro tier as planned |
| 3/4 pass | Open Pro pre-orders with a reduced cap (30 spots) |
| 2/4 pass | Delay Pro 4 weeks, ship Wave 1.5 (per community requests) |
| 0–1/4 pass | Halt the monetization plan; re-evaluate positioning |

**After Week 18 (Pro Tier Launch):**

| Metric | Target | If below target |
|---|---|---|
| Pro licenses sold | 50+ | Reposition Pro |
| Pro → active-usage rate | 60%+ | Improve onboarding |
| Refund rate | <5% | Address quality |
| Support ticket volume | <2/week | Improve docs |

**After Month 6 (Cloud Tier Decision):**

Signals to proceed with Cloud:
- 100+ Pro customers
- 10+ "is there a hosted version?" questions
- $5k+ MRR to cover infrastructure
- At least 1 Enterprise inquiry

Signals to delay Cloud:
- The Pro market is still validating
- Solo-dev capacity is overloaded
- No infrastructure budget
- No clear demand from non-dev customers

---

## 18. Risk Assessment & Mitigation

### 18.1 Technical Risks

**Risk:** SVG performance degrades on large projects (noticeable from ~1,000 tasks)
**Mitigation:** Automatically switch to the Canvas renderer above the **official 2,000-task threshold** (consistent with §4.1/§5.1). Use virtual scrolling. Benchmark continuously to tune the threshold.

**Risk:** Critical path algorithm bugs in edge cases (cycle, constraint)
**Mitigation:** An extensive test suite cross-checking against reference output from MS Project. Property-based testing with the fast-check library.

**Risk:** MS Project XML compatibility issues
**Mitigation:** Test with 20+ real .xml files from various MSP versions. Build a community-contributed test fixture library.

**Risk:** Timezone handling bugs (especially daylight saving)
**Mitigation:** Use the Temporal API, which handles this correctly. Avoid native `Date` for all computation.

### 18.2 Market Risks

**Risk (⚠️ HAS OCCURRED — 2026):** dhtmlx released a **Community Edition (MIT)**, erasing the "MIT-licensed" advantage as a standalone selling point for FluxGantt.
**Mitigation (updated):** No longer competing on the "who is MIT" axis — both are MIT. Also do **not** rely on AI auto-schedule for defense (now an industry standard, and dhtmlx can add it). Shift the moat to **measurable architecture that dhtmlx struggles to copy because of monolith technical debt**:
- **Bundle size**: 7.50 KiB gzip headless / 18.40 KiB editable vs 226 KiB for dhtmlx Community — the benchmark is published at `/docs/comparison` and re-runnable via `tooling/scripts/measure-competitor-bundles.mjs`. Frame it as "download only what you compose", not "smallest in class": Frappe is smaller (§2.2).
- **Genuine TypeScript-first + framework-agnostic core** + first-class React/Vue/Svelte wrappers (Community Edition has none).
- **Headless engine** running server-side → unlocks an **MCP server** (`@fluxgantt/mcp`) for AI agents — a qualitatively different AI integration, not an "AI button in the UI".
- Release velocity + a healthy community + DX (docs, types, StackBlitz examples) as developer-retention advantages.

**Risk:** A VC-funded competitor ships a similar product
**Mitigation:** Speed and community focus. Solo + Flux brand recognition for a 6–12 month early advantage. Pivot to a niche if needed.

**Risk:** AI scheduling is unstable in production
**Mitigation:** Position AI as "suggest", not "decide". Always show reasoning. Make reverts easy. Test thoroughly before shipping the Cloud tier.

**Risk:** An open-source contributor forks and creates a competing product
**Mitigation:** A healthy community + a responsive maintainer reduce the incentive to fork. Pro tier features create a commercial moat.

### 18.3 Execution Risks

**Risk:** Solo developer burnout during the 18-week sprint
**Mitigation:** Realistic weekly scope. Have a buffer week. Build-in-public reduces loneliness. Rest adequately.

**Risk:** Low Pro launch conversion
**Mitigation:** Keep the free tier generous to retain adoption. Email the waitlist to test demand before building. Validation gates prevent over-investment.

**Risk:** Support volume exceeds solo capacity
**Mitigation:** Thorough docs reduce the support load. A community forum for peer help. Email-only support, no SLA, until revenue is enough to hire.

**Risk:** Cloud tier infrastructure cost exceeds revenue
**Mitigation:** Charge fairly from the start. Use Cloudflare R2 (cheap storage), Fly.io (auto-scaling). Set hard limits per tier.

### 18.4 Legal Risks

**Risk:** License compliance disputes (commercial use of MIT)
**Mitigation:** Clear license terms. An FAQ about commercial use. The Pro tier provides a commercial-friendly EULA for those who want explicit licensing.

**Risk:** Patent infringement claims (scheduling algorithm)
**Mitigation:** CPM is public domain (developed in 1957). Clean-room implementation. Avoid copying dhtmlx's code or API verbatim.

**Risk:** GDPR/privacy compliance for the Cloud tier
**Mitigation:** Privacy-by-design from the start. Data residency option for Enterprise. A standard DPA template ready.

### 18.5 Security (Library & Cloud)

Technical threat model (full details & checklist in `.claude/rules/security.md`). Because FluxGantt is an **embedded library that renders untrusted data**, a vulnerability here affects every app using it.

**Library (Core/Pro) — runs inside the customer's app:**
- **XSS via render:** do NOT interpolate `task.name`/`notes`/`meta`/`color` into SVG/DOM via `innerHTML`/templates — use `textContent`/`setAttribute`. Whitelist-validate `color`. Sanitize SVG on export.
- **Untrusted parsing (JSON/CSV/XML):** validate the schema before loading into the store. **XML (MS Project) must disable external entities/DTD → prevent XXE**; limit size/depth to prevent DoS. CSV export guards against formula injection. Detect dependency cycles (throw).
- Respect the host's CSP (no inline script/`eval`).

**Cloud (Wave 3):**
- **Multi-tenant authZ:** scope every query by `org_id`/`project_id` + check `membership.role` on the server (prevents IDOR).
- **Share link:** token ≥32 bytes of entropy; `password_hash` uses argon2/bcrypt; respects `expires_at`/`permission`.
- **API key:** store only `key_hash` + `prefix`; support `scopes`/`revoked_at`.
- Parameterized SQL (Drizzle); HMAC-signed webhooks + SSRF protection; rate limiting (especially costly AI endpoints). Secrets not hardcoded/logged; Stripe webhook signature verified.

**AI:** separate user input from the system prompt; validate LLM output against a schema; AI *suggests*, doesn't *decide* (see §13.3).

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

**Dependency example:**

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

A complete outline for a reference implementation of the CPM algorithm.

```
function computeCriticalPath(
    tasks: Task[],
    dependencies: Dependency[],
    calendar: WorkingCalendar
): TaskId[] {

    // Step 1: Build the adjacency list
    successors: Map<TaskId, Dependency[]> = new Map()
    predecessors: Map<TaskId, Dependency[]> = new Map()

    for dep in dependencies:
        successors.get(dep.from).push(dep)
        predecessors.get(dep.to).push(dep)

    // Step 2: Topological sort (detects cycles)
    sorted = topologicalSort(tasks, dependencies)
    if sorted == null:
        throw new Error("Cycle detected in dependencies")

    // Step 3: Forward pass — compute earliest start/finish
    es: Map<TaskId, Date> = new Map()
    ef: Map<TaskId, Date> = new Map()

    for task in sorted:
        preds = predecessors.get(task.id) || []

        // NOTE: if task.constraint (must-start-on / start-no-earlier-than / ASAP...) exists
        //       → apply it to ES after computing from predecessors (constraint override).
        if preds.empty:
            es.set(task.id, task.start)          // or projectStart if ASAP
        else:
            earliest = -Infinity
            for pred in preds:
                predTask = tasks.find(t => t.id == pred.from)
                candidate = earliestStartFromPred(predTask, task, es, ef, pred.type, pred.lag, calendar)
                earliest = max(earliest, candidate)
            es.set(task.id, earliest)

        ef.set(task.id, addWorkingHours(es.get(task.id), task.duration, calendar))

    // Step 4: Determine the project end
    projectEnd = max(ef.values())

    // Step 5: Backward pass — compute latest start/finish
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

    // Step 6: Critical path = tasks with zero slack
    criticalPath: TaskId[] = []

    for task in tasks:
        // slack = LS - ES ≥ 0; differenceInWorkingHours(from, to) is positive when `to` is
        // after `from`, so the args must be (es, ls) — NOT (ls, es) (which yields a negative sign).
        slack = differenceInWorkingHours(es.get(task.id), ls.get(task.id), calendar)
        if slack == 0:
            criticalPath.push(task.id)

    return criticalPath
}

// Returns the earliest start for `succ` due to the constraint from ONE predecessor link.
// es/ef passed explicitly (no out-of-scope variables); FF/SF use succ.duration (not pred's).
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

| Feature | FluxGantt | dhtmlx PRO | dhtmlx Community | Bryntum Gantt | Frappe Gantt | jsGantt Improved |
|---|---|---|---|---|---|---|
| License | MIT | Comm. | **MIT** | Comm. | MIT | BSD |
| Price / dev / year | $0 | $599+ | $0 | $850+ | $0 | $0 |
| **Bundle size (gzip, incl. required CSS)** | **7.50kb** headless / **18.40kb** editable ✓ | heavy (monolith) | **226.18kb** (measured) | not measurable (login-gated) | **14.89kb** (measured — *smaller than FluxGantt editable*) | ~ |
| TypeScript native | ✓ | ~ | ~ | ✓ | ✗ | ✗ |
| Core framework-agnostic | ✓ | ✗ | ✗ | ~ | ~ | ✗ |
| Headless / server-side | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| React wrapper | ✓ | ✓ | ~ | ✓ | ✗ | ✗ |
| Vue wrapper | ✓ | ✓ | ~ | ✓ | ✗ | ✗ |
| Svelte wrapper | ✓* | ✗ | ✗ | ✗ | ✗ | ✗ |
| Angular wrapper | ✓* | ✓ | ~ | ✓ | ✗ | ✗ |
| All 4 dependency types | ✓ | ✓ | ✓ | ✓ | ✗ (FS only) | ✗ |
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
| Modern UI (2026) | ✓ | ~ | ~ | ✓ | ~ | ✗ |
| Accessibility (WCAG AA) | ✓ | ~ | ~ | ✓ | ✗ | ✗ |
| Dark mode | ✓ | ~ | ~ | ✓ | ~ | ✗ |
| Actively maintained | ✓ | ✓ | ✓ | ✓ | ~ | ✗ |

**Legend:**
`✓` = Yes · `✓*` = Yes, Wave 2 (Pro tier) · `✓**` = Yes, Pro tier · `✓***` = Yes, Cloud tier · `✗` = No · `~` = Partial / limited

`†` **AI auto-schedule is now an industry standard** — no longer an exclusive differentiator for FluxGantt. The real differentiators are **bundle size**, **headless/server-side**, **framework-agnostic core**, and **AI agent via MCP server** (the bold rows / FluxGantt-only). `dhtmlx Community` is derived from the PRO codebase as a funnel strategy: it ships some PRO features but **gates** resource/baseline/PDF to push users toward the paid build.

---

## Conclusion

This spec is a living document. As the product evolves, sections will be updated, and major changes will be reflected in the version number at the top of the document.

**Revision 0.1.3 (Week 8 — documentation & launch prep; bundle claims replaced by measurements):** marked §9.1 Week 8 item-by-item with what shipped and what is genuinely blocked, rather than ticking the week wholesale. Added `/docs/comparison` and `/docs/examples`, plus `apps/docs/launch/{show-hn,product-hunt}.md`. **Every competitor bundle figure in this spec was replaced with a measurement** from the new `tooling/scripts/measure-competitor-bundles.mjs`, which packs each library from npm at a pinned version and gzips its own entry point plus required stylesheet — and two of this document's own claims did not survive that: the "all competitors are hundreds-of-KB monoliths" framing is **false for Frappe** (14.89 KiB gzip, *smaller* than FluxGantt's 19.17 KiB editable chart), and **Bryntum is not independently measurable at all** (npm ships a 13 KB placeholder; the real bundle is login-gated). §2.2, §3.2, §4.2, §9.1, §17 and §21 were rewritten accordingly, and the positioning moved from "smallest in class" to "you download only what you compose, and the engine alone is 7.71 KiB" — the claim that survives a reader re-running the script. Also: the §3.2 tagline and §4.2 budgets now carry real numbers (7.71 / 23.82 KiB) instead of the original <15kb/<30kb targets, both of which are met; `apps/landing/` is documented as deliberately empty (the landing page is `apps/docs/pages/index.mdx`); and §15.1's third demo GIF ("AI scheduling") is replaced by a critical-path recompute, since AI scheduling is Wave 3. **Not done, and flagged rather than ticked:** the 3 demo GIFs and the Product Hunt image gallery (binary media, specified shot-by-shot but not capturable in-repo), and StackBlitz embeds (blocked on npm publication — `workspace:*` cannot resolve there). Launch itself is gated on publishing `@fluxgantt/core`.

**Revision 0.1.2 (competitive response — DHTMLX Community Edition):** added DHTMLX Gantt Community Edition (MIT) to the competitor landscape, split from dhtmlx PRO (§2.1); rewrote the Market Gap now that "MIT" + "AI" are no longer exclusive selling points (§2.2); repositioned the tagline/pitch around measurable architecture — headless, <15kb bundle, agent-native via MCP (§3.2); reduced the weight of AI auto-schedule (now an industry standard) and added the **MCP server** (`@fluxgantt/mcp`) as the Cloud differentiator, same direction as FluxDocs (§9.1, §9.3); marked the "dhtmlx ships an MIT build" risk as **HAS OCCURRED** with a new architecture-moat mitigation (§18.2); added a DHTMLX Community column plus bundle-size/headless/MCP rows to the competitor matrix (§21).

**Revision 0.1.1 (conflict-reconciliation review):** Temporal is an optional peerDependency excluded from the bundle budget (§4.1, §5.2); added `DateInput` + `Task.priority`, ID coercion at the boundary (§6); `GanttConfig` flags optional + default (§6.3); unified the flat `exportPng`/`importJson` API (§7.8); cascade behavior (§7.2); the `task:progressed` event (§7.9, §10.2); a11y kept in Canvas mode (§8.5); 2,000 renderer threshold (§18.1); DB↔type mapping (§12); configurable AI model (§13.3); fixed the `es` scope + `succ.duration` bug in the CPM pseudocode (§20); added §18.5 Security; export bundle uses `schemaVersion`.

**Contact:**

| | |
|---|---|
| GitHub | github.com/thai-pc/fluxgantt |
| Email | hello@fluxgantt.dev |
| Twitter | @fluxgantt |
