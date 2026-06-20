# FluxGantt — Technical Specification

> **The Modern MIT-Licensed Gantt Chart Library**

| | |
|---|---|
| **Version** | 0.1.1 (Pre-launch Draft — revised) |
| **Status** | Planning / Pre-build |
| **Author** | Flux Toolkit Team |
| **License** | Core MIT · Pro Commercial · Cloud SaaS |
| **Date** | 2026 |

---

## Overview

FluxGantt là thư viện Gantt chart TypeScript-first, license MIT, nhắm vào khoảng trống giữa hai cực: giải pháp commercial đắt đỏ (dhtmlx Gantt $599–1,599/dev/năm, Bryntum $850+/dev/năm) và các lựa chọn open-source yếu (Frappe Gantt, jsGantt Improved — đều thiếu tính năng, không có TypeScript, không có framework wrapper hiện đại).

Sản phẩm thuộc họ Flux (cùng với FluxFiles — file manager), dùng chung brand để giảm chi phí marketing và tạo trải nghiệm developer nhất quán.

**Ba tầng monetization:**

- **Core (MIT, free)** — render Gantt đầy đủ, dependencies, hierarchy
- **Pro (one-time)** — resource view, baselines, MS Project I/O, không AI
- **Cloud (subscription)** — multiplayer hosted, AI auto-scheduling, integrations

Đối tượng chính là **developer** nhúng Gantt vào ứng dụng web của họ, không phải end-user trực tiếp — định hướng này chi phối mọi quyết định từ API design đến pricing.

**Kiến trúc cốt lõi:** headless engine (state + logic) tách biệt hoàn toàn với rendering layer, render bằng SVG (fallback Canvas khi >2,000 tasks), state quản lý bằng reactive signal tự viết (không phụ thuộc React/Vue), tính toán ngày giờ dùng Temporal API để xử lý timezone/DST chính xác.

**Roadmap 3 wave:** Wave 1 (tuần 1–8) ship Core MIT MVP để thu hút GitHub stars; Wave 2 (tuần 11–18) thêm Pro tier (resource leveling, baseline, MS Project XML); Wave 3 (tháng 6+) xây Cloud tier với real-time multiplayer và AI auto-schedule.

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

FluxGantt là thư viện Gantt chart TypeScript-first, license MIT, nhắm vào khoảng trống giữa các giải pháp commercial đắt đỏ (dhtmlx Gantt $599–1,599/developer/năm, Bryntum $850+/developer/năm) và các lựa chọn open-source yếu (Frappe Gantt, jsGantt-improved, các plugin jQuery cũ).

Sản phẩm là một phần của họ Flux dành cho công cụ web hiện đại, cùng với FluxFiles (file manager). Brand chung giúp giảm chi phí marketing, xây dựng moat dài hạn qua trải nghiệm developer nhất quán, và cho phép cross-promotion giữa các sản phẩm.

Ba tầng monetization được lên kế hoạch:

- **Core (MIT, free):** Render Gantt đầy đủ, dependencies, hierarchy
- **Pro (one-time):** Resource view, baselines, MS Project I/O, không có AI
- **Cloud (subscription):** Multiplayer hosted, AI auto-scheduling, integrations

Sản phẩm nhắm đến developer nhúng tính năng Gantt vào ứng dụng web của riêng họ, không phải end-user trực tiếp. Định hướng này chi phối mọi quyết định, từ thiết kế API đến mô hình giá.

---

## 2. Market Analysis

### 2.1 Competitor Landscape

**Commercial / Closed Source:**

| Product | License | Pricing | Stack | Strengths | Weaknesses |
|---|---|---|---|---|---|
| **dhtmlx Gantt** | Commercial | $599/dev/năm (Standard)<br>$1,599/dev/năm (Enterprise) | JavaScript, không native TypeScript | Feature-complete, mature, MS Project parity | API lỗi thời, đắt, không có path MIT |
| **Bryntum Gantt** | Commercial | $850+/dev/năm | JavaScript, có framework wrapper | UI hiện đại, hỗ trợ React/Vue tốt | Giá cao, mô hình licensing sales-driven |
| **Highcharts Gantt** | Commercial (bundle với Highcharts) | Khóa trong Highcharts license ($1,295+) | JavaScript | Hệ sinh thái charts | License hạn chế, không chuyên về Gantt |

**Open Source:**

| Product | License | Stars | Stack | Status | Weaknesses |
|---|---|---|---|---|---|
| **Frappe Gantt** | MIT | ~12k GitHub | Vanilla JS, không TypeScript | Maintained nhưng chậm (~3 tháng/commit) | Không resource view, không critical path, dependency chỉ Finish-to-Start, không MS Project import, không TypeScript, không framework wrapper, visual cũ |
| **jsGantt Improved** | BSD | — | jQuery | Legacy | jQuery-based, gần như bỏ hoang, không hỗ trợ framework hiện đại |

### 2.2 Market Gap

Có cơ hội rõ ràng cho một thư viện MIT-licensed mang lại:

- API TypeScript-first với strict types
- Core framework-agnostic + wrapper React/Vue/Svelte hạng nhất
- Đầy đủ loại dependency (FS, SS, FF, SF) với cascade đúng chuẩn
- Resource view và leveling (tầng Pro)
- Tính toán Critical Path Method (CPM)
- Import/export MS Project XML (tầng Pro)
- Các tính năng AI chỉ khả thi từ 2023:
  - Auto-scheduling dưới constraint resource
  - Risk forecasting từ progress velocity
  - Nhập task bằng natural language

### 2.3 Customer Profile

**Primary Customer:**
- Developer solo/small-team xây dựng vertical SaaS
- Ví dụ: công cụ quản lý xây dựng, lập kế hoạch sản xuất video, scheduler sản xuất, công cụ PM nội bộ tùy chỉnh
- Pain point: giá dhtmlx $599–1,599/dev/năm, lo renewal, không có đường migration khỏi format proprietary
- Mức chi: $199–499 one-time/developer cho Pro license

**Secondary Customer:**
- Agency và consulting xây tool tùy chỉnh cho khách hàng
- Pain point: dự án khách hàng không đủ lớn để mua site license dhtmlx; xây từ đầu tốn 2–3 tháng
- Mức chi: $499–999 team license, one-time

**Tertiary Customer (Cloud tier, sau launch):**
- Team PM nhỏ muốn Gantt hosted mà không cần độ phức tạp như Asana/Monday
- Pain point: Asana/Monday quá nhiều tính năng dư thừa; Excel dễ vỡ
- Mức chi: $29–99/tháng/team

### 2.4 Total Addressable Market (TAM) Estimate

**Ước tính lower-bound dựa trên tín hiệu revenue của đối thủ:**

- Số lượng khách hàng dhtmlx Gantt: ~5,000–10,000 developer (ước tính)
- Bryntum: cùng order of magnitude
- Tổng thị trường thư viện Gantt commercial: ~$15–30M/năm

**Thị phần khả thi cho FluxGantt:**

- Năm 1: 50–100 Pro license × $299 = $15–30k
- Năm 2: 300–500 Pro + 50 Cloud sub = $90–180k ARR
- Năm 3: 1k+ Pro + 200 Cloud + Enterprise sớm = $300–500k ARR

---

## 3. Product Positioning & Branding

### 3.1 Brand Identity

| | |
|---|---|
| **Product Name** | FluxGantt |
| **Brand Family** | Flux (modern web tooling) |
| **Family Members** | FluxFiles (file manager, đang ship)<br>FluxGantt (Gantt chart, sản phẩm này)<br>FluxBoard (Kanban, tương lai)<br>FluxData (spreadsheet, tương lai)<br>FluxFlow (workflow editor, tương lai) |

### 3.2 Tagline & Positioning

> **Tagline:** "Drag tasks. Auto-resolve conflicts. Ship MIT."

> **Positioning:** "Thư viện Gantt chart MIT-licensed đầu tiên có AI-powered scheduling — xây cho web app hiện đại."

> **Elevator Pitch:** "Mọi app project management đều cần Gantt chart, và mọi developer xây nó đều đối mặt cùng lựa chọn: trả $1,000/năm cho dhtmlx, vật lộn với thư viện jQuery bỏ hoang, hoặc đốt ba tháng xây từ đầu. FluxGantt là lựa chọn còn thiếu — TypeScript-first, MIT-licensed, với AI scheduling chỉ khả thi từ khi có LLM."

### 3.3 Brand Voice

| | |
|---|---|
| **Tone** | Trực tiếp, kỹ thuật, tự tin nhưng không kiêu |
| **Reference** | Văn phong docs của TanStack, Tiptap, Drizzle ORM |
| **Tránh** | Marketing sáo rỗng: "revolutionary", "synergy", "next-gen" |
| **Ưu tiên** | Tuyên bố tính năng cụ thể, benchmark, code sample |

### 3.4 Visual Identity

| | |
|---|---|
| **Primary Color** | Indigo `#6366f1` — chuyên nghiệp, điềm tĩnh, khác biệt với màu xanh dhtmlx |
| **Critical Color** | Red `#ef4444` — chỉ dùng cho critical path |
| **Background** | Near-black `#0a0a0a` (dark mode), off-white `#fafafa` (light mode) |
| **Typography** | Inter (UI), JetBrains Mono (code samples) |
| **Logo Concept** | Bar ngang với arrow dependency dạng cascade, stylized |

### 3.5 Domain & Online Presence

| | |
|---|---|
| **Primary domain** | fluxgantt.dev |
| **Secondary** | fluxgantt.com (redirect về .dev) |
| **NPM scope** | `@fluxgantt` |
| **GitHub** | github.com/fluxtoolkit/fluxgantt |
| **Twitter/X** | @fluxgantt |
| **Discord** | Flux Toolkit community server (chung với FluxFiles) |

---

## 4. Technology Stack

### 4.1 Core Engine

| Layer | Choice |
|---|---|
| **Language** | TypeScript 5.4+, strict mode |
| **Module format** | ESM-first, fallback CJS qua tsup dual output |
| **Target** | ES2022 (browser hiện đại, Node 20+) |
| **Architecture** | Headless core (state + logic) tách biệt với rendering |
| **State management** | Reactive store dựa trên signal tự viết, theo semantics của Preact Signals, zero dependency với React/Vue |
| **Rendering** | SVG chính (sạch, vector, accessible, export được); fallback Canvas tự động khi task count > 2,000 |
| **Date arithmetic** | Temporal API qua lớp adapter nội bộ. Dùng `globalThis.Temporal` native nếu runtime có; `@js-temporal/polyfill` là **optional peerDependency** (consumer tự cài khi cần, KHÔNG bundle vào core → không tính vào bundle budget). `date-fns` chỉ cho ergonomics phụ. Lý do: Temporal xử lý timezone/DST đúng, native `Date` không đáng tin |
| **Multiplayer** | Yjs (CRDT) — chỉ Pro/Cloud. Reference: tldraw, BlockNote dùng Yjs thành công |
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
- `@fluxgantt/preact` — Preact (có thể trivial qua React compat)

### 4.3 Cloud Backend (Wave 3)

| | |
|---|---|
| **Runtime** | Node.js 22 LTS |
| **Framework** | Hono (lightweight, Edge-ready) |
| **Database** | PostgreSQL 16 |
| **ORM** | Drizzle (type-safe migration, lightweight) |
| **Real-time sync** | Yjs + y-websocket |
| **Auth** | Better-Auth (hiện đại, self-hostable, OAuth + email) |
| **Storage** | Cloudflare R2 (S3-compatible, rẻ) |
| **CDN** | Cloudflare (free tier) |
| **Hosting** | Fly.io (chính) hoặc Railway (thay thế) |
| **Email** | Resend (transactional) |
| **Payments** | Stripe (Pro one-time + Cloud subscription) |
| **Analytics** | Plausible (privacy-first) |

### 4.4 Documentation Site

| | |
|---|---|
| **Framework** | Vocs (Vite-based, dùng bởi Wagmi) |
| **Hosting** | Vercel hoặc Cloudflare Pages |
| **Search** | Built-in (Vocs tự xử lý) |
| **Code examples** | StackBlitz embed, edit trực tiếp |

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
│  - Component API idiomatic theo từng framework            │
│  - Tích hợp lifecycle                                     │
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
│  │  - DependencyStore (links giữa task)                   ││
│  │  - ResourceStore   (Pro: assignee, allocation)         ││
│  │  - BaselineStore   (Pro: snapshot của plan)            ││
│  │  - ViewportStore   (zoom, scroll, selection)           ││
│  └───────────────────────────────────────────────────────┘│
│  ┌───────────────────────────────────────────────────────┐│
│  │  Compute Layer                                        ││
│  │  - Critical Path (thuật toán CPM)                      ││
│  │  - Resource Leveling (Pro)                             ││
│  │  - Auto-Schedule (AI, tầng Cloud)                       ││
│  │  - Working Calendar (ngày làm việc, holiday)           ││
│  └───────────────────────────────────────────────────────┘│
│  ┌───────────────────────────────────────────────────────┐│
│  │  Render Layer                                         ││
│  │  - SVG renderer (chính, <2000 task)                   ││
│  │  - Canvas renderer (fallback, ≥2000 task)              ││
│  │  - Tự động chuyển dựa trên task count                  ││
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
│  │  Sync Layer (chỉ Cloud)                                ││
│  │  - Yjs adapter                                         ││
│  │  - Presence (cursor, selection)                        ││
│  │  - Conflict resolution                                 ││
│  └───────────────────────────────────────────────────────┘│
└───────────────────────────────────────────────────────────┘
```

### 5.2 Design Principles

1. **Headless first** — Core engine dùng được hoàn toàn không cần render. State và compute có thể chạy server-side hoặc trong test mà không cần DOM.

2. **Reactive subscription, không full re-render** — Consumer subscribe vào delta cụ thể (task X di chuyển, dependency Y được thêm) thay vì nhận full state snapshot. Cho phép UI update chính xác và performance tốt với 1000+ task.

3. **Plugin system cho tính năng non-core** — MS Project import, AI scheduling, custom calendar đều là plugin. Giữ core bundle dưới 30kb gzip.

4. **Tree-shakable mọi thứ** — Chỉ import module cần dùng. Một Gantt "hello world" chỉ render task nên dưới 15kb gzip. Budget core (<30kb) / hello-world (<15kb) **không bao gồm Temporal polyfill** (optional peerDependency, xem §4.1).

5. **Core framework-agnostic, wrapper opinionated** — Core không có opinion về UI framework. Wrapper cung cấp API idiomatic cho mỗi framework (hooks cho React, composable cho Vue, runes cho Svelte...).

6. **Type safety end-to-end** — Branded type cho ID ngăn việc truyền nhầm `TaskId` vào chỗ cần `ResourceId`. Strict null check ở mọi nơi.

7. **Server-friendly** — Core chạy được trong Node.js (hoặc Workers) không cần DOM. Cho phép server-side rendering, validation server-side, và test headless.

---

## 6. Core Type System

### 6.1 Branded ID Types

```typescript
// Ngăn việc trộn lẫn ID type ở compile time
type Brand<T, B> = T & { readonly __brand: B };

type TaskId       = Brand<string, 'TaskId'>;
type ResourceId   = Brand<string, 'ResourceId'>;
type DependencyId = Brand<string, 'DependencyId'>;
type BaselineId   = Brand<string, 'BaselineId'>;
type ProjectId    = Brand<string, 'ProjectId'>;
```

> **Coercion ở boundary:** API công khai nhận `string` cho ID (xem ví dụ §7.1); core tự brand nội bộ qua helper `toTaskId(s: string): TaskId`. Người dùng KHÔNG phải tự viết `as TaskId`. Branded type chỉ ràng buộc nội bộ giữa các hàm core để tránh trộn `TaskId`/`ResourceId`.

### 6.2 Core Entity Types

```typescript
// Mọi mốc lịch trình nhận nhiều dạng ở input, chuẩn hoá về Temporal nội bộ
type DateInput = string | Date | Temporal.ZonedDateTime | Temporal.PlainDate;

type Task = {
  id:          TaskId;
  name:        string;
  start:       DateInput;          // string ISO | Date | Temporal; chuẩn hoá về Temporal nội bộ
  end:         DateInput;          // như trên
  duration?:   number;             // working hour; derive từ start/end nếu thiếu
  progress:    number;             // 0..1
  priority?:   number;             // số nhỏ = ưu tiên cao; dùng cho resource leveling (§13.2)
  parent?:     TaskId;             // parent trong hierarchy
  type:        'task' | 'summary' | 'milestone' | 'project';
  constraint?: TaskConstraint;
  resources?:  ResourceAssignment[];
  notes?:      string;
  color?:      string;             // override màu mặc định
  meta?:       Record<string, unknown>;  // field tùy biến của user
  createdAt:   Date;
  updatedAt:   Date;
};

type DependencyType =
  | 'FS'   // Finish-to-Start  (mặc định; B bắt đầu sau khi A kết thúc)
  | 'SS'   // Start-to-Start   (B bắt đầu khi A bắt đầu)
  | 'FF'   // Finish-to-Finish (B kết thúc khi A kết thúc)
  | 'SF';  // Start-to-Finish  (B kết thúc khi A bắt đầu; hiếm dùng)

type Dependency = {
  id:    DependencyId;
  from:  TaskId;
  to:    TaskId;
  type:  DependencyType;
  lag?:  number;        // giờ; âm = lead time
};

type TaskConstraint =
  | { kind: 'asap' }                           // càng sớm càng tốt
  | { kind: 'alap' }                           // càng muộn càng tốt
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
  capacity:     number;          // giờ/ngày có thể làm
  cost?:        { rate: number; currency: string };
  calendar?:    WorkingCalendar; // override working calendar mặc định
  color?:       string;
  avatar?:      string;
};

type ResourceAssignment = {
  resourceId:  ResourceId;
  units:       number;           // 0..1 = % allocation
};

type Baseline = {
  id:        BaselineId;
  name:      string;             // ví dụ "v1.0 — Initial plan"
  capturedAt: Date;
  tasks:     Map<TaskId, { start: Date; end: Date; duration: number }>;
};

type WorkingCalendar = {
  workingDays:   ('mon'|'tue'|'wed'|'thu'|'fri'|'sat'|'sun')[];
  workingHours:  { start: string; end: string }[];   // ví dụ "09:00"–"17:00"
  holidays:      DateInput[];
  timezone:      string;         // IANA timezone, ví dụ "America/New_York"
};
```

### 6.3 Configuration Type

```typescript
type GanttConfig = {
  // Dữ liệu khởi tạo
  tasks?:        Task[];
  dependencies?: Dependency[];
  resources?:    Resource[];      // Pro
  baselines?:    Baseline[];      // Pro

  // Hiển thị (đều optional + có default; thường chỉ cần set viewMode)
  viewMode?:     'day' | 'week' | 'month' | 'quarter' | 'year';  // default 'week'
  density?:      'compact' | 'default' | 'comfortable';          // default 'default'
  theme?:        'light' | 'dark' | 'auto';                      // default 'auto'
  rtl?:          boolean;                                        // default false
  locale?:       string;          // default 'en'

  // Calendar
  calendar?:     WorkingCalendar;

  // Tính năng (optional; default false trừ khi ghi chú)
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

> **Cascade:** `moveTask` / `resizeTask` / `updateTask` mặc định dời các task phụ thuộc theo dependency (FS/SS/FF/SF + lag) và tôn trọng `constraint`, phát `task:moved` cho mọi task bị ảnh hưởng. Tắt bằng scheduling mode `manual`.

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

FluxGantt là công cụ business chuyên nghiệp. Aesthetic phải truyền tải "enterprise-grade software" nhưng vẫn dễ tiếp cận. Chủ động tránh:

- Style hand-drawn / sketchy (kiểu Excalidraw)
- Illustration playful
- Gradient nặng hoặc neumorphism
- Icon cartoon

Ưu tiên:

- Hình khối geometric sạch
- Whitespace rộng ở density comfortable
- Thông tin dày đặc ở density compact (cho power user)
- Shadow tinh tế, không nặng
- System font và Inter cho khả năng đọc đa ngôn ngữ

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
  --fg-task-baseline:       #94a3b8;   /* slate — baseline kế hoạch */
  --fg-task-milestone:      #f59e0b;   /* amber — marker hình thoi */

  /* Resource colors */
  --fg-resource-normal:     #10b981;
  --fg-resource-overload:   #fb923c;   /* orange — over-allocated */
  --fg-resource-critical:   #dc2626;   /* dark red — over nghiêm trọng */

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
│  Detail panel (khi task được chọn)                               │
│  Name: ...   Resource: ...   Progress: 50%   [Edit] [Delete]     │
└──────────────────────────────────────────────────────────────────┘
```

### 8.4 Interaction Patterns

**Direct manipulation:**

| Hành động | Kết quả |
|---|---|
| Click + drag giữa bar | Di chuyển task |
| Click + drag cạnh bar | Resize task |
| Click + drag handle | Tạo dependency tới task khác |
| Double click bar | Mở detail edit |
| Right click | Mở context menu |

**Keyboard:**

| Phím | Hành động |
|---|---|
| Arrow keys | Di chuyển selection giữa các task |
| Tab | Di chuyển giữa cell trong task list |
| Space | Select / deselect |
| Cmd/Ctrl + D | Duplicate task |
| Cmd/Ctrl + Z / Shift+Z | Undo / redo |
| Cmd/Ctrl + +/- | Zoom in / out |
| Delete | Xóa task đã chọn |
| Enter | Edit inline tên task đã chọn |

**Zoom:**

| Hành động | Kết quả |
|---|---|
| Mouse wheel + Ctrl | Zoom in/out |
| Pinch gesture | Zoom trên touch device |

### 8.5 Accessibility

- Đạt chuẩn tối thiểu WCAG 2.1 AA
- Mọi interaction đều keyboard-accessible
- ARIA label cho screen reader
- Màu sắc được test với color blindness
- Critical path phân biệt được không cần màu (viền dashed)
- Focus indicator trên mọi phần tử tương tác
- Tôn trọng `prefers-reduced-motion`
- **Chế độ Canvas (≥2.000 task)** vẫn giữ a11y: một lớp DOM ẩn (offscreen) chứa ARIA grid + row focusable chạy song song với Canvas vẽ bar, để keyboard navigation và screen reader không bị mất khi đổi renderer (xem §5.1). WCAG AA áp dụng cho cả hai renderer.

---

## 9. Feature Roadmap (3 Waves)

### 9.1 Wave 1 — Free MVP (Tier: Core MIT, Tuần 1–8)

**Mục tiêu:** Ship một Gantt MIT-licensed hoạt động tốt, vượt Frappe Gantt về tính năng và developer experience, đủ để thu hút user ban đầu và GitHub star.

**Tuần 1–2: Foundation**
- Setup monorepo (pnpm + turbo + changesets)
- Core package skeleton
- Data model Task + TaskStore (reactive)
- SVG timeline renderer cơ bản
- Zoom level: day / week / month / quarter / year
- Today line marker
- Chuyển theme light/dark

**Tuần 3–4: Interactions**
- Drag để move task
- Drag cạnh để resize
- Hierarchy (parent/child) với auto-rollup duration
- Click selection (single + multi với Shift/Ctrl)
- Keyboard navigation
- Working calendar (ngày làm việc, holiday)

**Tuần 5: Dependencies & Critical Path**
- Dependencies: đủ 4 loại (FS, SS, FF, SF)
- Hỗ trợ lag/lead time
- Arrow auto-routing giữa các bar
- Drag handle để tạo dependency mới
- Tính toán critical path (thuật toán CPM)
- Highlight visual cho critical path

**Tuần 6: Framework Wrappers**
- `@fluxgantt/react` với hooks
- `@fluxgantt/vue` với Composition API
- Sample app cho mỗi framework

**Tuần 7: Polish & Export**
- Export PNG / SVG
- Import/export JSON / CSV
- Milestone (marker hình thoi)
- Read-only mode
- Scaffold i18n (chỉ English lúc launch, structure sẵn sàng mở rộng)
- Responsive mobile

**Tuần 8: Documentation & Launch Prep**
- Documentation site (Vocs)
- 10+ example live trên StackBlitz
- Landing page với 3 GIF demo
- README với quick start
- Trang so sánh (vs dhtmlx, Bryntum, Frappe)
- Draft bài Show HN
- Asset cho Product Hunt

### 9.2 Wave 2 — Pro Tier (Tuần 11–18, sau khi validate)

**Mục tiêu:** Thêm tính năng developer chịu trả $199–499 one-time.

**Tuần 11–12: MS Project Compatibility**
- Import MS Project XML (.xml format)
- Export MS Project XML
- Migration guide từ dhtmlx
- Test với 20 file MS Project thực tế

**Tuần 13–14: Resource View**
- Data model Resource + ResourceStore
- Gán resource cho task
- Chart workload resource (panel riêng)
- Override calendar resource
- Cảnh báo visual khi over-allocation
- Thuật toán resource leveling

**Tuần 15–16: Baselines & Constraints**
- Capture baseline (snapshot)
- So sánh multi-baseline
- Visual diff (planned vs actual)
- Task constraint (must-start-on, ASAP, ALAP, v.v.)
- Custom column trong task list
- Filter nâng cao

**Tuần 17: Advanced Export**
- Export PDF với header/footer tùy chỉnh
- Print preview
- Export multi-page cho project lớn
- Bỏ watermark (chỉ Pro)

**Tuần 18: Polish & Pro Launch**
- Hệ thống validate license key
- Tích hợp Stripe Checkout (one-time payment)
- Pro documentation
- Pro tier landing page
- Email blast cho waitlist
- Public Pro launch

### 9.3 Wave 3 — Cloud + AI Tier (Tháng 6+)

**Mục tiêu:** Recurring revenue qua hosted multiplayer Gantt với tính năng AI.

**Tháng 6–7: Cloud Foundation**
- Backend API (Hono + Postgres)
- Auth user + model organization
- Quản lý project + workspace
- Stripe subscription
- Cloud SDK package

**Tháng 8–9: Real-time Multiplayer**
- Tích hợp Yjs
- Presence (live cursor, indicator selection)
- Comment và @mention cho mỗi task
- Activity feed / audit log
- Share link với password và expiry

**Tháng 10–11: AI Features**
- AI auto-schedule (LLM + constraint solver)
- AI giải thích conflict
- AI risk forecaster (dựa trên progress velocity)
- Nhập task bằng natural language
- AI-generated postmortem khi project kết thúc

**Tháng 12: Integrations**
- Webhook (task thay đổi, đạt milestone)
- Slack notification
- Email digest (tiến độ hàng tuần)
- Connector Zapier
- Sync Jira / Linear / Asana

---

## 10. API Naming Conventions

### 10.1 Method Naming

Verb + noun, camelCase. Tránh prefix "set"/"get" chung cho action; chỉ dùng cho property access đơn giản.

**Nên dùng:**
```typescript
gantt.addTask(task)
gantt.linkTasks(fromId, toId, 'FS')
gantt.computeCriticalPath()
gantt.exportPng()
gantt.zoomTo('week')
gantt.scrollToTask(taskId)
```

**Tránh:**
```typescript
gantt.task_add(task)                  // snake_case
gantt.createNewTaskInGantt(task)      // dài dòng
gantt.do('add', task)                 // action generic
gantt.set('zoom', 'week')             // setter generic
```

### 10.2 Event Naming

Thì past tense, namespace bằng dấu hai chấm, lowercase. Đọc như "điều gì đó đã xảy ra".

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

Prefix mọi class với `fg-` để tránh xung đột với host application.

| Loại | Ví dụ |
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

PascalCase, không prefix "I" (convention cũ), suffix mô tả chỉ khi cần.

**Nên dùng:**
```typescript
type Task = { ... }
type Dependency = { ... }
type DependencyType = 'FS' | 'SS' | 'FF' | 'SF'
type GanttConfig = { ... }
type GanttInstance = { ... }
type ResourceAssignment = { ... }
```

**Tránh:**
```typescript
interface ITask { ... }            // prefix I lỗi thời
type TaskType = { ... }            // suffix Type dư thừa
type taskConfig = { ... }          // camelCase sai
```

**Branded ID:**
```typescript
type TaskId = string & { readonly __brand: 'TaskId' }
type ResourceId = string & { readonly __brand: 'ResourceId' }
```

### 10.5 File & Folder Naming

| Loại | Convention | Ví dụ |
|---|---|---|
| Files | kebab-case | `task-store.ts`, `critical-path.ts` |
| Folders | kebab-case | `store/`, `compute/`, `render/` |
| Tests | `*.test.ts` | `task-store.test.ts` |
| Types | `types.ts` | mỗi package hoặc feature folder |
| Index | `index.ts` | barrel export |

### 10.6 NPM Package Names

| Package | Mô tả |
|---|---|
| `@fluxgantt/core` | Headless engine (Wave 1) |
| `@fluxgantt/react` | React wrapper (Wave 1) |
| `@fluxgantt/vue` | Vue wrapper (Wave 1) |
| `@fluxgantt/svelte` | Svelte wrapper (Wave 2) |
| `@fluxgantt/angular` | Angular wrapper (Wave 2) |
| `@fluxgantt/ai` | Tính năng AI scheduling (Pro) |
| `@fluxgantt/msproject` | MS Project import/export (Pro) |
| `@fluxgantt/cloud-sdk` | Cloud API client (Wave 3) |
| `@fluxgantt/themes` | Theme dựng sẵn (community) |
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
│   │   │   ├── gantt.ts            # Entry chính: createGantt()
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
│   │   │   ├── signals.ts           # Reactive primitive tự viết
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
│   ├── landing/                    # Landing page marketing (Next.js hoặc Astro)
│   └── playground/                 # Playground tương tác (StackBlitz host)
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

PostgreSQL schema cho bản Cloud hosted. Dùng Drizzle ORM.

> **Mapping DB ↔ type:** một số cột đặt tên khác field trong type công khai (§6.2): `tasks.end_at` ↔ `Task.end`, `tasks.constraint_data` ↔ `Task.constraint`, `resources.cost_rate`/`cost_curr` ↔ `Resource.cost`. Lớp ánh xạ nằm trong `@fluxgantt/cloud-sdk`, không để chênh lệch tên rò ra API công khai.

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

-- Membership (quan hệ user <-> org nhiều-nhiều)
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
  duration    INT,                       -- theo working hour
  progress    NUMERIC(3,2) DEFAULT 0,    -- 0.00 đến 1.00
  type        VARCHAR(20) DEFAULT 'task',-- task/summary/milestone/project
  constraint_data JSONB,
  notes       TEXT,
  color       VARCHAR(20),
  meta        JSONB,                      -- field tùy biến user
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
  capacity    NUMERIC(5,2) DEFAULT 8.0,    -- giờ/ngày
  cost_rate   NUMERIC(10,2),
  cost_curr   VARCHAR(3),
  calendar    JSONB,
  color       VARCHAR(20),
  avatar_url  TEXT,
  user_id     UUID REFERENCES users(id),   -- link tới user nếu type='person'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Resource assignments
CREATE TABLE resource_assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  resource_id   UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  units         NUMERIC(3,2) DEFAULT 1.0,  -- 0.00 đến 1.00
  UNIQUE(task_id, resource_id)
);

-- Baselines
CREATE TABLE baselines (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name          VARCHAR(200) NOT NULL,
  snapshot      JSONB NOT NULL,             -- state task lúc capture
  captured_by   UUID REFERENCES users(id),
  captured_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Comments
CREATE TABLE comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id),
  content     TEXT NOT NULL,
  mentions    UUID[],                      -- array user ID được mention
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

-- API keys (cho webhook integration)
CREATE TABLE api_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        VARCHAR(200) NOT NULL,
  key_hash    VARCHAR(255) NOT NULL,
  prefix      VARCHAR(10) NOT NULL,         -- prefix hiện để nhận diện
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

Critical path là chuỗi task phụ thuộc dài nhất, quyết định thời gian tối thiểu của project. Task trên critical path có zero slack; bất kỳ delay nào cũng kéo dài trực tiếp ngày kết thúc project.

**Pseudocode (đơn giản hóa):**

```
function computeCriticalPath(tasks, dependencies):
    // 1. Topological sort task theo thứ tự dependency
    sorted = topologicalSort(tasks, dependencies)

    // 2. Forward pass: tính earliest start (ES) và earliest finish (EF)
    for task in sorted:
        predecessors = dependencies.where(d => d.to == task.id)
        if predecessors is empty:
            task.ES = task.start
        else:
            task.ES = max(pred.EF + pred.lag for pred in predecessors)
        task.EF = task.ES + task.duration

    // 3. Backward pass: tính latest start (LS) và latest finish (LF)
    projectEnd = max(task.EF for task in tasks)
    for task in reversed(sorted):
        successors = dependencies.where(d => d.from == task.id)
        if successors is empty:
            task.LF = projectEnd
        else:
            task.LF = min(succ.LS - succ.lag for succ in successors)
        task.LS = task.LF - task.duration

    // 4. Slack = LS - ES; critical path = task có slack == 0
    criticalPath = [task for task in tasks if task.LS - task.ES == 0]

    return criticalPath
```

**Edge case cần xử lý:**

- Cycle trong dependency (phát hiện, throw error)
- Task có constraint (override ES/LF tính toán)
- Working calendar (skip ngày không làm việc)
- Lag/lead time (dương = chờ, âm = overlap)

### 13.2 Resource Leveling

Khi resource bị over-allocated, dịch task để giải quyết conflict trong khi vẫn tôn trọng dependency và constraint.

**Cách tiếp cận (heuristic-based):**

```
function levelResources(tasks, dependencies, resources):
    while overAllocated(resources):
        conflict = findEarliestOverAllocation(resources)
        candidateTasks = tasksUsing(conflict.resource, conflict.timeWindow)

        // Sort theo priority: priority thấp trước, rồi slack cao trước
        candidateTasks.sortBy(t => [t.priority, -t.slack])

        for task in candidateTasks:
            if canDelayWithoutBreakingDependencies(task):
                delayTo(task, conflict.resource.nextAvailable)
                break
        else:
            // Không thể resolve mà không vi phạm constraint
            report(conflict)
            break

    recomputeCriticalPath()
```

### 13.3 AI Auto-Schedule (Cloud Tier)

Dùng LLM để generate schedule ban đầu từ mô tả natural language, sau đó tinh chỉnh bằng constraint solver.

```
function autoSchedule(naturalLanguageInput):
    // Stage 1: LLM trích xuất task, dependency, duration
    prompt = `Extract project plan from this description.
              Output JSON with tasks and dependencies.
              ${naturalLanguageInput}`

    structuredPlan = callLLM(prompt, model=config.aiModel)  // model cấu hình được, không hardcode

    // Stage 2: Áp dụng working calendar và resource constraint
    tasks = parseTasks(structuredPlan)
    dependencies = parseDependencies(structuredPlan)

    // Stage 3: Chạy topological sort + tính earliest start
    scheduledTasks = applyConstraints(tasks, dependencies, calendar, resources)

    // Stage 4: Validate, optimize critical path
    if hasResourceConflicts(scheduledTasks):
        scheduledTasks = levelResources(scheduledTasks, dependencies, resources)

    return scheduledTasks
```

> **Bảo mật AI:** tách `naturalLanguageInput` (untrusted) khỏi system prompt; **validate lại** `structuredPlan` bằng schema trước khi dùng; AI chỉ *suggest* (user review + revert), không tự ghi đè plan. Chi tiết: `.claude/rules/security.md`.

---

## 14. Pricing & Monetization

### 14.1 Tier Structure

| Tier | Giá | Đối tượng |
|---|---|---|
| **Core (MIT)** | $0 | Dự án OSS, evaluation, hobby |
| **Pro Self-host** | $299 one-time | Indie dev, agency (per developer license) |
| **Pro Team** | $999 one-time | Team dev nhỏ (tới 10 developer) |
| **Cloud Starter** | $29/tháng | Team nhỏ (Cloud, 5 user) |
| **Cloud Team** | $99/tháng | Công ty đang phát triển (25 user) |
| **Cloud Business** | $299/tháng | Mid-market (user không giới hạn) |
| **Enterprise** | $5k–50k/năm | Tổ chức lớn (SSO, on-prem, SLA) |

### 14.2 Feature Matrix

| Tính năng | Core | Pro | Cloud | Ent |
|---|---|---|---|---|
| Task CRUD | ✓ | ✓ | ✓ | ✓ |
| Dependencies (FS/SS/FF/SF) | ✓ | ✓ | ✓ | ✓ |
| Tính toán critical path | ✓ | ✓ | ✓ | ✓ |
| Wrapper React/Vue | ✓ | ✓ | ✓ | ✓ |
| Export PNG/SVG/JSON | ✓ | ✓ | ✓ | ✓ |
| Resource view | – | ✓ | ✓ | ✓ |
| Resource leveling | – | ✓ | ✓ | ✓ |
| Baselines | – | ✓ | ✓ | ✓ |
| Task constraints | – | ✓ | ✓ | ✓ |
| MS Project XML I/O | – | ✓ | ✓ | ✓ |
| Export PDF có branding | – | ✓ | ✓ | ✓ |
| Custom columns | – | ✓ | ✓ | ✓ |
| Wrapper Svelte/Angular | – | ✓ | ✓ | ✓ |
| Bỏ watermark | – | ✓ | ✓ | ✓ |
| Email support | – | ✓ | ✓ | ✓ |
| Real-time multiplayer | – | – | ✓ | ✓ |
| Comment + @mention | – | – | ✓ | ✓ |
| Activity feed | – | – | ✓ | ✓ |
| AI auto-schedule | – | – | ✓ | ✓ |
| AI risk forecaster | – | – | ✓ | ✓ |
| Share link có permission | – | – | ✓ | ✓ |
| Integration Slack/Email | – | – | ✓ | ✓ |
| Webhooks | – | – | ✓ | ✓ |
| Priority support | – | – | ✓ | ✓ |
| SSO (SAML, OIDC) | – | – | – | ✓ |
| Audit log retention | – | – | – | ✓ |
| On-premise deployment | – | – | – | ✓ |
| DPA, SOC2, HIPAA BAA | – | – | – | ✓ |
| SLA 99.9% uptime | – | – | – | ✓ |
| Dedicated success manager | – | – | – | ✓ |

### 14.3 Vì sao Pro là One-Time

Developer thiên về thanh toán license one-time cho thư viện:

- Component library là infrastructure, không phải workflow tool
- "Subscription fatigue" là thật; developer hạn chế chi phí recurring
- Thanh toán one-time loại bỏ rủi ro churn cho mình, giảm lo lắng cho khách
- License key dễ validate và renew update lifetime
- Stripe Checkout one-time = integration đơn giản, không cần state subscription

### 14.4 Vì Sao Cloud là Recurring

Tầng Cloud hợp lý với subscription vì:

- Hosting, bandwidth, storage là chi phí ongoing
- Multiplayer cần chạy server liên tục
- Tính năng AI có chi phí per-call
- Khách hàng mong đợi uptime, update, support
- Recurring revenue tài trợ cho phát triển ongoing

---

## 15. Distribution & Launch Strategy

### 15.1 Pre-Launch (Tuần 7–8)

- Landing page live tại fluxgantt.dev
- Form đăng ký waitlist nổi bật
- 3 GIF demo: drag task / dependency cascade / AI scheduling
- Tweet thread sneak peek tới dev community
- GitHub repo public với README chỉn chu

### 15.2 Launch Day (Tuần 8)

Launch đa kênh đồng bộ:

- **Show HN post** (thứ Ba, 8h sáng PT là tối ưu):
  *"Show HN: FluxGantt — MIT-licensed Gantt chart library with AI scheduling"*

- **Product Hunt launch** (thứ Ba–Năm): chuẩn bị maker comment, screenshot, gallery, video

- **Reddit posts:**
  - r/webdev (chung)
  - r/javascript (kỹ thuật)
  - r/reactjs (community React)
  - r/vuejs (community Vue)
  - r/SaaS (nếu nhắm SaaS founder)

- **Dev.to article:**
  *"Why we built another Gantt library (and why it matters)"* — bài kỹ thuật dài giải thích market gap và architecture

- **Hashnode + Medium cross-post**

- **Email outreach** tới 50 PM tool startup: message cá nhân hóa kiểu "Built MIT Gantt alternative to dhtmlx with AI scheduling. Want a demo? Happy to help integrate if you're using Frappe or paying dhtmlx."

- **Twitter/X build-in-public thread:** GIF tiến độ hàng ngày trước launch

### 15.3 Post-Launch (Ongoing)

**Nội dung SEO:**
- "FluxGantt vs dhtmlx Gantt" — nhắm người chuyển từ dhtmlx
- "FluxGantt vs Bryntum" — nhắm người chuyển từ Bryntum
- "FluxGantt vs Frappe Gantt" — nhắm path upgrade từ free
- "How to add Gantt to Next.js" — tutorial SEO
- "Vue 3 Gantt chart tutorial" — tutorial SEO

**Discord community:** Mở sau 100+ user. Chung với community FluxFiles.

**Conference talks:** Submit cho React Conf, VueConf, JSConf với talk *"Building a scheduling engine without VC funding"*.

**Open source contributions:** Xây wrapper cho OSS PM tool phổ biến (Plane, Vikunja) để tích hợp FluxGantt — distribution tức thì tới user base của họ.

**YouTube channel:** Tutorial + behind-the-scenes development.

---

## 16. 18-Week Execution Plan

| Tuần | Phase | Deliverable | Metric chính |
|---|---|---|---|
| 1 | Build | Monorepo, core skeleton, task model, SVG renderer | Repo public, CI green |
| 2 | Build | Drag-resize, zoom level, hierarchy | Demo hoạt động đầu tiên |
| 3 | Build | Dependencies (đủ 4 loại), arrow routing | Tất cả dep type hoạt động |
| 4 | Build | Critical path, today line, working calendar | CPM verify với file MS Project |
| 5 | Build | React wrapper, hook `useFluxGantt`, sample app | npm publish alpha |
| 6 | Build | Vue wrapper, Composition API, sample app | Cả 2 wrapper ổn định |
| 7 | Polish | Export PNG/SVG, milestone, docs site, example | Docs site live |
| 8 | **LAUNCH** | Show HN + Product Hunt + Reddit + email outreach | 500+ GH stars, 1k+ npm download |
| 9 | Listen | Bug fix, review PR, engagement community | Triage 80% issue |
| 10 | Listen | Iterate theo feedback, cải thiện docs | DX polish, mở rộng example |
| 11 | Pre-order | Email blast: "Pro early bird $199, 100 chỗ đầu" | 30–50 pre-order |
| 12 | Build Pro | Import MS Project XML | Import sạch 20 file .xml mẫu |
| 13 | Build Pro | Resource view + assignment | UI hoàn chỉnh |
| 14 | Build Pro | Thuật toán resource leveling | Thuật toán đã validate |
| 15 | Build Pro | Capture + compare baseline | Visual diff hoạt động |
| 16 | Build Pro | Constraint, export PDF, custom column | Export pass test Acrobat |
| 17 | Polish | Pro docs, migration guide, hệ thống license key | Hệ thống license hoạt động |
| 18 | **LAUNCH Pro** | Pro tier live, email khách pre-order | 50+ Pro license bán = $10k+ revenue |

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

**Risk:** dhtmlx ra bản MIT để cạnh tranh
**Mitigation:** Đẩy nhanh tính năng AI (auto-schedule, risk forecast) mà họ không thể replicate nhanh. Xây community.

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
        slack = differenceInWorkingHours(ls.get(task.id), es.get(task.id), calendar)
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

| Tính năng | FluxGantt | dhtmlx Gantt | Bryntum Gantt | Frappe Gantt | jsGantt Improved |
|---|---|---|---|---|---|
| License | MIT | Comm. | Comm. | MIT | BSD |
| Giá / dev / năm | $0 | $599+ | $850+ | $0 | $0 |
| TypeScript native | ✓ | ~ | ✓ | ✗ | ✗ |
| Core framework-agnostic | ✓ | ✗ | ~ | ~ | ✗ |
| React wrapper | ✓ | ✓ | ✓ | ✗ | ✗ |
| Vue wrapper | ✓ | ✓ | ✓ | ✗ | ✗ |
| Svelte wrapper | ✓* | ✗ | ✗ | ✗ | ✗ |
| Angular wrapper | ✓* | ✓ | ✓ | ✗ | ✗ |
| Đủ 4 loại dependency | ✓ | ✓ | ✓ | ~ | ✗ |
| Critical path | ✓ | ✓ | ✓ | ✗ | ✗ |
| Resource view | ✓** | ✓ | ✓ | ✗ | ✗ |
| Resource leveling | ✓** | ✓ | ✓ | ✗ | ✗ |
| Baselines | ✓** | ✓ | ✓ | ✗ | ✗ |
| MS Project XML import | ✓** | ✓ | ✓ | ✗ | ✗ |
| Export PDF | ✓** | ✓ | ✓ | ~ | ✗ |
| AI auto-schedule | ✓*** | ✗ | ✗ | ✗ | ✗ |
| AI risk forecaster | ✓*** | ✗ | ✗ | ✗ | ✗ |
| Real-time multiplayer | ✓*** | ✗ | ✗ | ✗ | ✗ |
| UI hiện đại (2026) | ✓ | ~ | ✓ | ~ | ✗ |
| Accessibility (WCAG AA) | ✓ | ~ | ✓ | ✗ | ✗ |
| Dark mode | ✓ | ~ | ✓ | ~ | ✗ |
| Maintained tích cực | ✓ | ✓ | ✓ | ~ | ✗ |

**Chú thích:**
`✓` = Có · `✓*` = Có, Wave 2 (Pro tier) · `✓**` = Có, tầng Pro · `✓***` = Có, tầng Cloud · `✗` = Không · `~` = Một phần / hạn chế

---

## Kết

Đây là bản spec living document. Khi sản phẩm phát triển, các phần sẽ được cập nhật, và thay đổi lớn sẽ phản ánh qua version number ở đầu tài liệu.

**Revision 0.1.1 (review hoà giải mâu thuẫn):** Temporal là optional peerDependency không tính vào bundle budget (§4.1, §5.2); thêm `DateInput` + `Task.priority`, ID coercion ở boundary (§6); `GanttConfig` flags optional + default (§6.3); thống nhất API flat `exportPng`/`importJson` (§7.8); cascade behavior (§7.2); event `task:progressed` (§7.9, §10.2); a11y giữ ở chế độ Canvas (§8.5); ngưỡng renderer 2.000 (§18.1); mapping DB↔type (§12); AI model cấu hình được (§13.3); sửa lỗi scope `es` + `succ.duration` trong pseudocode CPM (§20); thêm §18.5 Security; export bundle dùng `schemaVersion`.

**Liên hệ:**

| | |
|---|---|
| GitHub | github.com/fluxtoolkit/fluxgantt |
| Email | hello@fluxgantt.dev |
| Twitter | @fluxgantt |
