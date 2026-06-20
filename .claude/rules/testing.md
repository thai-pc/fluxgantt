# Rule: Testing

## Mọi tính năng mới PHẢI có test. Không có ngoại lệ cho compute layer.

## Công cụ
| Loại | Tool | Ở đâu |
|---|---|---|
| Unit | **vitest** | `packages/*/tests/unit/`, hoặc co-located `*.test.ts` |
| Integration | vitest | `packages/*/tests/integration/` |
| Property-based | **fast-check** | cho thuật toán (CPM, leveling, calendar) |
| E2E | **playwright** | `tests/e2e/` |
| Visual regression | playwright snapshots | `tests/visual/` |
| Accessibility | playwright + axe | `tests/a11y/` |
| Performance / benchmark | vitest bench / custom | `tests/performance/` |
| Wrapper component | **@testing-library** | `packages/{react,vue,...}/tests/` |
| Fixtures | file dữ liệu mẫu | `packages/*/tests/fixtures/`, `tests/fixtures/`, `packages/msproject/fixtures/` |

## Ưu tiên test theo layer
1. **Compute layer (cao nhất)** — critical-path, resource-leveling, working-calendar, cascade, duration. Headless, thuần hàm → dễ test, bug ở đây tốn nhất.
   - **Critical path: đối chiếu output với reference từ MS Project thật.** Property-based với fast-check (thêm task/dep ngẫu nhiên, kiểm bất biến: không cycle → có path, slack≥0, projectEnd ổn định).
   - **Edge case bắt buộc**: cycle (phải throw), constraint override, ngày không làm việc (skip), lag dương (chờ) + lag âm (overlap/lead), DST boundary.
2. **State layer** — store reactive: subscribe nhận đúng delta, không re-emit thừa, undo/redo.
3. **IO layer** — round-trip (import→export→import bằng nhau). MS Project: test với **20+ file .xml thực tế** nhiều version. CSV/JSON: malformed input không crash (xem security).
4. **Render** — visual regression snapshot (SVG + Canvas), chuyển renderer ở ngưỡng 2000 task.
5. **Interaction** — e2e: drag move/resize, tạo dependency, keyboard nav, touch.
6. **Wrapper** — @testing-library: prop binding, lifecycle mount/unmount, callback fire đúng.

## Quy ước
- Test phải chạy **headless** (core không cần DOM). Không phụ thuộc network/clock thật — fake timer, inject calendar.
- Date: test cả nhiều timezone (vd `America/New_York`, `Asia/Ho_Chi_Minh`, `UTC`) và qua mốc DST.
- Performance budget có test: bundle size (core <30kb gzip, hello world <15kb), render 1000+ task, chuyển Canvas ≥2000.
- A11y: WCAG 2.1 AA — keyboard reachable, ARIA label, focus indicator, `prefers-reduced-motion`, critical path phân biệt không cần màu.
- CI phải green trước merge: `lint` + `typecheck` + `test` + `test:e2e` + size-limit.

## Lệnh
```bash
pnpm -r test            # unit + integration
pnpm test:e2e           # playwright
pnpm test:visual        # visual regression
pnpm test -- --coverage # coverage
```
Mục tiêu coverage compute layer ~100% branch; phần khác hợp lý, không chạy theo con số mù quáng.
