# Rule: Project Overview

## FluxGantt là gì
Thư viện Gantt chart **TypeScript-first, MIT-licensed**, nhắm khoảng trống giữa commercial đắt đỏ (dhtmlx $599–1599/dev/năm, Bryntum $850+/dev/năm) và open-source yếu (Frappe Gantt, jsGantt Improved). Đối tượng chính: **developer nhúng Gantt vào web app của họ** — không phải end-user. Định hướng này chi phối mọi quyết định API và pricing.

Thuộc họ **Flux** (FluxFiles, FluxBoard, FluxData, FluxFlow). Dùng chung brand.

## Ba tier monetization
| Tier | Giá | Gồm gì |
|---|---|---|
| **Core (MIT, free)** | $0 | Render đầy đủ, dependencies (FS/SS/FF/SF), hierarchy, critical path, React/Vue, export PNG/SVG/JSON/CSV |
| **Pro (one-time)** | $299/dev, $999/team | Resource view + leveling, baselines, task constraints, MS Project XML I/O, PDF branding, custom columns, Svelte/Angular, bỏ watermark |
| **Cloud (subscription)** | $29–299/tháng | Multiplayer (Yjs), comment/@mention, activity feed, AI auto-schedule, risk forecast, share link, integrations, webhooks |
| **Enterprise** | $5k–50k/năm | SSO, audit retention, on-prem, DPA/SOC2/HIPAA, SLA |

**Pro = one-time** (developer ghét subscription cho library/infra). **Cloud = recurring** (hosting/AI/multiplayer là chi phí ongoing).

## Roadmap 3 wave
- **Wave 1 (tuần 1–8)** — Core MIT MVP. Mục tiêu: GitHub stars, npm downloads. Gate: 500+ stars / 1k+ weekly downloads / 200+ waitlist sau 30 ngày.
- **Wave 2 (tuần 11–18)** — Pro tier (MS Project XML, resource leveling, baseline, constraints, license key + Stripe one-time).
- **Wave 3 (tháng 6+)** — Cloud tier (Hono+Postgres backend, Yjs multiplayer, AI features, integrations).

## Khi build, luôn nhớ
- Tính năng nào thuộc tier nào (xem feature matrix mục 14.2 của spec). **Không rò rỉ code Pro/Cloud vào core bundle.**
- DX (developer experience) là moat: API sạch, types chặt, docs tốt, example chạy được trên StackBlitz.
- Tham chiếu so sánh: phải hơn Frappe Gantt về tính năng + DX ngay từ Wave 1.

## Nguồn chân lý
Spec đầy đủ: `/Users/thai-pc/Downloads/fluxgantt-spec.md`. Khi spec và code mâu thuẫn, hỏi lại — spec là living document.
