# Rule: Project Overview

## What FluxGantt is
A **TypeScript-first, MIT-licensed** Gantt chart library targeting the gap between expensive commercial offerings (dhtmlx $599–1599/dev/year, Bryntum $850+/dev/year) and weak open-source ones (Frappe Gantt, jsGantt Improved). The primary audience: **developers embedding a Gantt into their web app** — not end users. This orientation drives every API and pricing decision.

Part of the **Flux** family (FluxFiles, FluxBoard, FluxData, FluxFlow). Shared brand.

## Three monetization tiers
| Tier | Price | Includes |
|---|---|---|
| **Core (MIT, free)** | $0 | Full rendering, dependencies (FS/SS/FF/SF), hierarchy, critical path, React/Vue, export PNG/SVG/JSON/CSV |
| **Pro (one-time)** | $299/dev, $999/team | Resource view + leveling, baselines, task constraints, MS Project XML I/O, PDF branding, custom columns, Svelte/Angular, no watermark |
| **Cloud (subscription)** | $29–299/month | Multiplayer (Yjs), comment/@mention, activity feed, AI auto-schedule, risk forecast, share link, integrations, webhooks |
| **Enterprise** | $5k–50k/year | SSO, audit retention, on-prem, DPA/SOC2/HIPAA, SLA |

**Pro = one-time** (developers hate subscriptions for a library/infra). **Cloud = recurring** (hosting/AI/multiplayer are ongoing costs).

## 3-wave roadmap
- **Wave 1 (weeks 1–8)** — Core MIT MVP. Goal: GitHub stars, npm downloads. Gate: 500+ stars / 1k+ weekly downloads / 200+ waitlist after 30 days.
- **Wave 2 (weeks 11–18)** — Pro tier (MS Project XML, resource leveling, baseline, constraints, license key + Stripe one-time).
- **Wave 3 (month 6+)** — Cloud tier (Hono+Postgres backend, Yjs multiplayer, AI features, integrations).

## Always keep in mind when building
- Which feature belongs to which tier (see the feature matrix in §14.2 of the spec). **Do not leak Pro/Cloud code into the core bundle.**
- DX (developer experience) is the moat: clean API, tight types, good docs, examples that run on StackBlitz.
- Comparison reference point: must beat Frappe Gantt on features + DX from Wave 1 on.

## Source of truth
Full spec: `apps/docs/fluxgantt-spec.md`. When the spec and code conflict, ask — the spec is a living document.
