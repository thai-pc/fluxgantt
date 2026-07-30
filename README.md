<div align="center">

# FluxGantt

**The Modern MIT-Licensed Gantt Chart Library**

TypeScript-first · headless · framework-agnostic · AI-powered scheduling

`Drag tasks. Auto-resolve conflicts. Ship MIT.`

</div>

---

FluxGantt is a TypeScript-first, MIT-licensed Gantt chart library targeting the gap between
expensive commercial offerings (dhtmlx, Bryntum) and weak open-source ones (Frappe Gantt,
jsGantt). Its headless core is fully decoupled from rendering, renders to SVG (Canvas
fallback above 2000 tasks), and does all date/time math with the Temporal API.

## Tiers

| Tier | Price | Includes |
|---|---|---|
| **Core** (MIT) | Free | Rendering, dependencies (FS/SS/FF/SF), hierarchy, critical path, React/Vue, export PNG/SVG/JSON/CSV |
| **Pro** (one-time) | $299/dev | Resource view + leveling, baselines, constraints, MS Project XML I/O, PDF, custom columns, Svelte/Angular |
| **Cloud** (subscription) | from $29/month | Multiplayer (Yjs), comment/@mention, AI auto-schedule, risk forecast, integrations |

## Repo layout (monorepo — pnpm + turbo)

```
packages/    core, react, vue, svelte, angular, ai, msproject, cloud-sdk
examples/    demos per framework + feature
apps/        docs (Vocs), landing, playground
tooling/     eslint-config, tsconfig, scripts
tests/       e2e, visual, a11y, performance (Playwright)
```

## Getting started with development

```bash
pnpm install
pnpm build        # turbo builds all packages
pnpm test         # unit tests (vitest)
pnpm test:e2e     # e2e (playwright)
pnpm lint && pnpm typecheck
```

Requirements: Node >= 20 (22 recommended), pnpm 10+.

## Docs for AI / contributors

- [`CLAUDE.md`](./CLAUDE.md) — high-level context + golden rules
- [`.claude/rules/`](./.claude/rules) — architecture, conventions, testing, **security**
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — contribution workflow

## License

Core: [MIT](./LICENSE). Pro & Cloud under a separate commercial license.
