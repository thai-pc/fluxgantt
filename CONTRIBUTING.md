# Contributing to FluxGantt

Cảm ơn bạn đã quan tâm! Tài liệu này tóm tắt quy trình. Quy ước chi tiết nằm trong
[`.claude/rules/`](./.claude/rules).

## Setup

```bash
pnpm install
pnpm build
pnpm test
```

Node >= 20 (khuyến nghị 22, xem `.nvmrc`), pnpm 10+.

## Nguyên tắc bắt buộc

- **Headless first** — code trong `core/src/{store,compute}` không import DOM/framework.
- **Framework-agnostic core** — `@fluxgantt/core` không import react/vue/svelte.
- **Temporal API** cho mọi tính toán ngày giờ, không native `Date`.
- **TypeScript strict**, branded ID, không `any`.
- **Tree-shakable** — không side-effect top-level; giữ bundle budget (core <30kb, hello-world <15kb gzip).
- **Mọi tính năng mới đi kèm test** (xem `.claude/rules/testing.md`).
- **Security** — validate mọi input ngoài (xem `.claude/rules/security.md`).

## Quy trình PR

1. Tạo branch từ `main`.
2. Code + test. Chạy `pnpm lint && pnpm typecheck && pnpm test`.
3. `pnpm changeset` — mô tả thay đổi (bump version + changelog tự động).
4. Mở PR. CI phải green (lint, typecheck, test, e2e, size-limit).

## Code style

- File kebab-case (`task-store.ts`), component PascalCase (`FluxGantt.tsx`).
- Method: verb + noun camelCase. Event: past-tense `noun:verb`. Type: PascalCase, không prefix `I`.
- CSS: BEM với prefix `fg-`, custom property `--fg-*`.
- Prettier + ESLint (config dùng chung trong `tooling/`).

## Báo lỗi bảo mật

Không mở issue công khai cho lỗ hổng bảo mật. Email: security@fluxgantt.dev.
