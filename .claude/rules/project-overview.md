# Rule: Project Overview

## What FluxGantt is
A **TypeScript-first, MIT-licensed** Gantt chart library. The primary audience: **developers embedding a Gantt into their web app** — not end users. This orientation drives every API and pricing decision. Target buyers: developers building **B2B SaaS** who hit the SaaS/OEM clauses of commercial Gantt licences, and the orphaned users of `gantt-task-react` (archived, last release 2022-07-10, still ~63k weekly downloads).

Part of the **Flux** family (FluxFiles, FluxBoard, FluxData, FluxFlow). Shared brand.

## Competitors (2026-11 strategy revision)
"MIT but weak" is no longer the alternative. The real MIT-tier rivals are vendor-backed:
- **DHTMLX Gantt 10 Community** — MIT since 2026-06-11; keeps auto-scheduling, critical path and resource planning in PRO. DHTMLX PRO from **$799 perpetual** (1 dev, 1 project, 1 year of updates); SaaS "upon request for a fee".
- **SVAR Gantt** — MIT core; SVAR PRO from **$749** (1 dev), and that cheapest tier **excludes SaaS** (SaaS starts at the $1,899 Application tier).
- **Bryntum Gantt 8 Community** — MIT since 2026-11-03; critical path, baselines, MS Project import and PDF export sit in Enterprise. Business **$699** / Enterprise **$1,100** per dev per year; **SaaS requires an OEM licence** (quoted).
- Suite vendors for scale: **Syncfusion Gantt $959 per dev per year**.

Prices are list prices read 2026-11-11/12 (sources in `reports/Thị trường thư viện Gantt JS.md`: dhtmlx.com licensing, bryntum.com/store/gantt, svar.dev/react/gantt/pricing, syncfusion.com/sales/pricing). Frappe Gantt and jsGantt Improved are no longer the benchmark.

## The wedge
No pillar stands alone; the combination is the pitch:
**critical path (CPM) in MIT core + headless engine that runs in Node/Workers + small tree-shakable bundle + tested WCAG 2.1 AA + a permissive licence with no SaaS restriction.**
- Free CPM **stays in core** (every MIT rival paywalls it).
- Every bundle-size claim must keep the Temporal-polyfill disclosure (sizes exclude `@js-temporal/polyfill`, ~45.8 KiB gzip, needed where Temporal is not native).
- Don't claim "the only accessible MIT Gantt" (DHTMLX has WAI-ARIA); claim WCAG 2.1 AA **tested with axe in CI** and a critical path distinguishable without color.

## Tiers
| Tier | Price | Includes |
|---|---|---|
| **Core (MIT, free)** | $0 | Full rendering, dependencies (FS/SS/FF/SF), hierarchy, critical path, React/Vue **and Svelte/Angular** wrappers, **basic/custom grid columns**, export PNG/SVG/JSON/CSV |
| **Pro (perpetual)** | ~$600–800/dev — **planned, not yet on sale** | Resource view + leveling, baselines, task constraints, MS Project XML I/O, PDF branding. 12 months of updates; optional paid renewal at ~50–70%. **Licence allows use in SaaS products, no OEM surcharge.** |

- No watermark, ever (an MIT core cannot enforce one, and none exists).
- Wrappers are distribution, not product: they stay MIT.

## Roadmap
- **Wave 1** — Core MIT MVP. **Shipped** (first npm release 2026-09-24). Original gate: 500+ stars / 1k+ weekly downloads / 200+ waitlist after 30 days.
- **Wave 2** — Pro tier (MS Project XML, resource leveling, baselines, constraints, PDF branding, licence key + one-time checkout). Validate the price with refundable pre-orders before building.
- **Growth channel (MIT)** — an MCP server plus `llms.txt`, so AI coding assistants can find and use FluxGantt.
- **Sync adapter (Yjs)** — a binding the customer runs on their own backend; built **only on pre-sold demand**.

### Not committed / exploratory
The hosted **Cloud subscription** (multiplayer, comments/@mention, activity feed, AI auto-schedule, risk forecast, share links, integrations, webhooks; Hono + Postgres backend) and the **Enterprise** tier (SSO, audit retention, on-prem, DPA/SOC2/HIPAA, SLA) are **not on the roadmap** as of the 2026-11 revision: a hosted PM product is a different business with no demand evidence yet. Kept here as history only. Do not build toward them unless explicitly requested; if they are ever revived, `.claude/rules/security.md` §3–4 still apply as the guidance for that work.

## Always keep in mind when building
- Which feature belongs to which tier (see the feature matrix in §14.2 of the spec). **Do not leak Pro code into the core bundle.**
- DX (developer experience) is the moat: clean API, tight types, good docs, examples that run on StackBlitz.
- Comparison reference point: DHTMLX Community and SVAR (MIT). Win on the wedge above, not on feature breadth.

## Source of truth
Full spec: `apps/docs/fluxgantt-spec.md`. When the spec and code conflict, ask — the spec is a living document.
