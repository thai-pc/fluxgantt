<div align="center">

# FluxGantt

**The Modern MIT-Licensed Gantt Chart Library**

TypeScript-first · headless · framework-agnostic · AI-powered scheduling

`Drag tasks. Auto-resolve conflicts. Ship MIT.`

</div>

---

FluxGantt là thư viện Gantt chart TypeScript-first, license MIT, nhắm khoảng trống giữa
commercial đắt đỏ (dhtmlx, Bryntum) và open-source yếu (Frappe Gantt, jsGantt). Core
headless tách biệt hoàn toàn rendering, render SVG (fallback Canvas khi >2000 task), tính
ngày giờ bằng Temporal API.

## Tiers

| Tier | Giá | Gồm |
|---|---|---|
| **Core** (MIT) | Free | Render, dependencies (FS/SS/FF/SF), hierarchy, critical path, React/Vue, export PNG/SVG/JSON/CSV |
| **Pro** (one-time) | $299/dev | Resource view + leveling, baselines, constraints, MS Project XML I/O, PDF, custom columns, Svelte/Angular |
| **Cloud** (subscription) | từ $29/tháng | Multiplayer (Yjs), comment/@mention, AI auto-schedule, risk forecast, integrations |

## Cấu trúc repo (monorepo — pnpm + turbo)

```
packages/    core, react, vue, svelte, angular, ai, msproject, cloud-sdk
examples/    demo cho từng framework + tính năng
apps/        docs (Vocs), landing, playground
tooling/     eslint-config, tsconfig, scripts
tests/       e2e, visual, a11y, performance (Playwright)
```

## Bắt đầu phát triển

```bash
pnpm install
pnpm build        # turbo build tất cả package
pnpm test         # unit test (vitest)
pnpm test:e2e     # e2e (playwright)
pnpm lint && pnpm typecheck
```

Yêu cầu: Node >= 20 (khuyến nghị 22), pnpm 10+.

## Tài liệu cho AI / contributor

- [`CLAUDE.md`](./CLAUDE.md) — ngữ cảnh tổng quan + quy tắc vàng
- [`.claude/rules/`](./.claude/rules) — architecture, conventions, testing, **security**
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — quy trình đóng góp

## License

Core: [MIT](./LICENSE). Pro & Cloud theo license thương mại riêng.
