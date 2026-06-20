# FluxGantt — AI Context (CLAUDE.md)

> Thư viện Gantt chart TypeScript-first, license MIT. Headless engine tách biệt rendering.
> Spec gốc: `apps/docs/fluxgantt-spec.md` (living document, v0.1.0).

File này là điểm vào ngữ cảnh cho AI. Chi tiết được tách thành các rules trong `.claude/rules/`.
**Trước khi code, đọc rule liên quan.**

## Rules (đọc khi cần)
- @.claude/rules/project-overview.md — sản phẩm, tier, monetization, roadmap
- @.claude/rules/architecture.md — kiến trúc layered, design principles, type system
- @.claude/rules/coding-conventions.md — naming, file layout, API style
- @.claude/rules/testing.md — chiến lược test (vitest, playwright, fast-check)
- @.claude/rules/security.md — **BẮT BUỘC đọc** trước khi đụng IO/auth/cloud/AI

## Quy tắc vàng (tóm tắt, không vi phạm)
1. **Headless first** — core chạy được không cần DOM (Node/Workers/test). Không import DOM API trong `store/`, `compute/`, `io` thuần dữ liệu.
2. **Framework-agnostic core** — `@fluxgantt/core` KHÔNG được import `react`/`vue`/`svelte`. Opinion về framework chỉ nằm trong wrapper.
3. **Date = Temporal API**, không dùng native `Date` cho mọi tính toán (timezone/DST). Native `Date` chỉ ở boundary I/O.
4. **TypeScript strict** — không `any` ngầm, branded ID (`TaskId`, `ResourceId`...) không trộn lẫn.
5. **Tree-shakable + bundle budget** — core "hello world" < 15kb gzip, full core < 30kb gzip. Tính năng non-core là plugin.
6. **Tier-gate đúng chỗ** — Pro (resource/baseline/MSProject), Cloud (multiplayer/AI). Đừng nhét code Pro/Cloud vào `core`.
7. **Mọi tính năng mới đi kèm test.** Xem `.claude/rules/testing.md`.
8. **Security**: validate mọi input ngoài (import file, share link, API). Xem `.claude/rules/security.md`.

## Tech stack chốt
TypeScript 5.4+ strict · ESM-first (tsup dual) · ES2022 · pnpm workspaces + turbo · changesets ·
vitest (unit) · playwright (e2e/visual) · @testing-library (wrappers) · Temporal polyfill ·
Yjs (Pro/Cloud) · Hono + Postgres + Drizzle + Better-Auth (Cloud) · Stripe · Vocs (docs).

## Cấu trúc repo
`packages/*` (core, react, vue, svelte, angular, ai, msproject, cloud-sdk) ·
`examples/*` · `apps/*` (docs, landing, playground) · `tooling/*` · `tests/*` (e2e/visual/a11y/performance) · `.changeset/`.

## Lệnh thường dùng (sau khi setup)
```bash
pnpm install
pnpm -r build          # build mọi package qua turbo
pnpm -r test           # unit test (vitest)
pnpm test:e2e          # playwright
pnpm lint && pnpm typecheck
pnpm changeset         # tạo changeset trước khi release
```

## Đang ở giai đoạn nào
Pre-build / Wave 1 (Core MIT MVP). Ưu tiên: TaskStore reactive → SVG renderer → drag → dependencies → critical path → React/Vue wrapper → export → docs. Chưa làm Pro/Cloud trừ khi được yêu cầu rõ.
