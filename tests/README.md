# Tests (cross-package)

Test cấp workspace chạy bằng **Playwright** (config: `playwright.config.ts` ở gốc).
Unit/integration của từng package nằm trong `packages/*/tests` (vitest).

| Thư mục | Mục đích | Trạng thái |
|---|---|---|
| `e2e/` | Tương tác UI thật (drag, dependency, keyboard) | Có sanity test; test thật chờ SVG renderer |
| `visual/` | Visual regression (screenshot) | Mẫu đang `skip`; bật khi renderer ổn định |
| `a11y/` | Kiểm WCAG (Playwright + axe) | Chờ renderer |
| `performance/` | Benchmark render 1000+ task, ngưỡng Canvas 2.000 | Chờ renderer |
| `fixtures/` | Dữ liệu mẫu dùng chung | — |

## Chạy

```bash
pnpm exec playwright install chromium   # lần đầu: tải browser
pnpm test:e2e                           # project e2e
pnpm test:visual                        # project visual
pnpm test:visual --update-snapshots     # sinh/cập nhật baseline screenshot
```

## Khi renderer xong
1. Thêm `webServer` vào `playwright.config.ts` trỏ tới `examples/plain-html-demo`.
2. Thay `page.setContent(...)` bằng `page.goto(...)` trong các spec.
3. Bỏ `.skip` ở `visual/timeline.spec.ts`, sinh baseline trên image CI.
4. Bổ sung a11y (axe) + performance theo `.claude/rules/testing.md`.
