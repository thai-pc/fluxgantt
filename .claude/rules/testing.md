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
- Performance budget is tested: bundle size (seven gzip fixtures in `packages/core/size-limit/`, from `createGantt()`-only up to the fully-composed instance — see CLAUDE.md golden rule 5 for the table), rendering 1000+ tasks, Canvas switch ≥2000.
- A11y: WCAG 2.1 AA — keyboard reachable, ARIA labels, focus indicator, `prefers-reduced-motion`, critical path distinguishable without color.
- CI must be green before merge: `lint` + `typecheck` + `test` + `test:e2e` + size-limit.

## Commands
```bash
pnpm -r test                 # unit + integration
pnpm test:e2e                # playwright, desktop interaction (Desktop Chrome)
pnpm test:visual             # visual regression snapshots
pnpm test:a11y               # axe / WCAG
pnpm test:mobile             # Pixel 5, the only project with a coarse pointer
pnpm test:performance        # Canvas mount-time budgets
pnpm test:webkit-canvas-dimension-guard
pnpm test -- --coverage      # coverage
```
Every script is `--project=`-scoped, so a bare `playwright test` is the only way to run all six at
once — and locally that is a bad idea, because the concurrent browsers skew `performance`'s
wall-clock budgets. **All six run in CI** (`ci.yml`'s `e2e` job); each has its own step for the
same `--project=` reason.

Visual baselines are committed PER PLATFORM (`<title>-visual-darwin.png` +
`-linux.png`) and neither platform can regenerate the other's. Updating a snapshot on a Mac
therefore leaves the linux half stale: get it from a CI run rather than hand-editing, and never
delete a platform's file to make a failure go away.
Target ~100% branch coverage for the compute layer; reasonable elsewhere — don't chase a number blindly.
