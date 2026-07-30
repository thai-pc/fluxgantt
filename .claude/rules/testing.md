# Rule: Testing

## Every new feature MUST have tests. No exception for the compute layer.

## Tools
| Kind | Tool | Where |
|---|---|---|
| Unit | **vitest** | `packages/*/tests/unit/`, or co-located `*.test.ts` |
| Integration | vitest | `packages/*/tests/integration/` |
| Property-based | **fast-check** | for algorithms (CPM, leveling, calendar) |
| E2E | **playwright** | `tests/e2e/` |
| Visual regression | playwright snapshots | `tests/visual/` |
| Accessibility | playwright + axe | `tests/a11y/` |
| Performance / benchmark | vitest bench / custom | `tests/performance/` |
| Wrapper component | **@testing-library** | `packages/{react,vue,...}/tests/` |
| Fixtures | sample data files | `packages/*/tests/fixtures/`, `tests/fixtures/`, `packages/msproject/fixtures/` |

## Test priority by layer
1. **Compute layer (highest)** — critical-path, resource-leveling, working-calendar, cascade, duration. Headless, pure functions → easy to test, bugs here are the costliest.
   - **Critical path: cross-check output against a real MS Project reference.** Property-based with fast-check (add random tasks/deps, check invariants: no cycle → a path exists, slack≥0, projectEnd stable).
   - **Required edge cases**: cycle (must throw), constraint override, non-working day (skip), positive lag (wait) + negative lag (overlap/lead), DST boundary.
2. **State layer** — reactive store: subscriptions receive the correct delta, no redundant re-emits, undo/redo.
3. **IO layer** — round-trip (import→export→import is equal). MS Project: test with **20+ real .xml files** across versions. CSV/JSON: malformed input doesn't crash (see security).
4. **Render** — visual regression snapshots (SVG + Canvas), renderer switch at the 2000-task threshold.
5. **Interaction** — e2e: drag move/resize, create dependency, keyboard nav, touch.
6. **Wrapper** — @testing-library: prop binding, mount/unmount lifecycle, callbacks fire correctly.

## Conventions
- Tests must run **headless** (core needs no DOM). No dependency on real network/clock — fake timers, inject the calendar.
- Dates: test multiple timezones (e.g. `America/New_York`, `Asia/Ho_Chi_Minh`, `UTC`) and across DST boundaries.
- Performance budget is tested: bundle size (core <30kb gzip, hello world <15kb), rendering 1000+ tasks, Canvas switch ≥2000.
- A11y: WCAG 2.1 AA — keyboard reachable, ARIA labels, focus indicator, `prefers-reduced-motion`, critical path distinguishable without color.
- CI must be green before merge: `lint` + `typecheck` + `test` + `test:e2e` + size-limit.

## Commands
```bash
pnpm -r test            # unit + integration
pnpm test:e2e           # playwright
pnpm test:visual        # visual regression
pnpm test -- --coverage # coverage
```
Target ~100% branch coverage for the compute layer; reasonable elsewhere — don't chase a number blindly.
