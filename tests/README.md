# Tests (cross-package)

Workspace-level tests run with **Playwright** (config: `playwright.config.ts` at the root).
Per-package unit/integration tests live in `packages/*/tests` (vitest).

| Directory | Purpose | Status |
|---|---|---|
| `e2e/` | Real UI interaction (drag, dependency, keyboard) | Sanity test present; real tests await the SVG renderer |
| `visual/` | Visual regression (screenshots) | Sample is `skip`ped; enable once the renderer is stable |
| `a11y/` | WCAG checks (Playwright + axe) | Awaiting the renderer |
| `performance/` | Benchmark rendering 1000+ tasks, the 2,000-task Canvas threshold | Awaiting the renderer |
| `fixtures/` | Shared sample data | — |

## Running

```bash
pnpm exec playwright install chromium   # first time: download the browser
pnpm test:e2e                           # e2e project
pnpm test:visual                        # visual project
pnpm test:visual --update-snapshots     # generate/update baseline screenshots
```

## Once the renderer is done
1. Add a `webServer` to `playwright.config.ts` pointing at `examples/plain-html-demo`.
2. Replace `page.setContent(...)` with `page.goto(...)` in the specs.
3. Remove `.skip` in `visual/timeline.spec.ts`, generate the baseline on the CI image.
4. Add a11y (axe) + performance per `.claude/rules/testing.md`.
