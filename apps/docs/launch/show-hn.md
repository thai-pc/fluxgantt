# Show HN — draft

Not published. Spec §9.1 (Week 8) and §15.2 call for a Show HN post; this is the draft, kept in the
repo so it can be reviewed and edited like anything else.

**Send only when all three are true:**

1. `@fluxgantt/core` is published to npm. HN will not forgive a "Show HN" you cannot install, and
   the README's own pre-release note (`README.md:23`) still says the packages are unpublished.
2. The docs site is deployed at a public URL. Right now every docs link in this draft points at a
   file path in the repo.
3. The three demo GIFs exist. A Gantt library submitted without a moving picture of a bar being
   dragged will be ignored.

Timing per §15.2: Tuesday, ~08:00 PT.

---

## Title

The 80-character limit is the real constraint. Candidates, all measured:

> `Show HN: FluxGantt – MIT Gantt chart library, 7.7 KB headless core, TypeScript` — 78 chars

> `Show HN: FluxGantt – a TypeScript-first, MIT-licensed Gantt chart library` — 72 chars

> `Show HN: FluxGantt – an MIT Gantt library with a headless 7.7 KB core` — 68 chars

Recommend the first. The number is the differentiator and putting it in the title makes the
comparison argument before anyone clicks.

**Do not** use the phrasing suggested in spec §15.2 — *"MIT-licensed Gantt chart library with AI
scheduling"*. AI scheduling is Wave 3 and does not exist yet; leading with it would be a false
claim on the one post where credibility matters most. Spec §2.2 already concluded that AI is no
longer a differentiator anyway.

**URL:** the docs site landing page, not the GitHub repo. HN readers click through to the repo on
their own; they will not click through *to* docs.

---

## Body

Hi HN — I'm the author.

Every project-management app eventually needs a Gantt chart, and the existing options are all
uncomfortable. dhtmlx PRO and Bryntum are mature and good, at $599–1,599 and $850+ per developer
per year. The MIT options are lighter on your wallet and heavier on your bundle: dhtmlx's new
Community edition is 226 KB gzip once you include its required stylesheet. Frappe Gantt is a
genuinely small 15 KB, but it has no critical path, only finish-to-start dependencies, and no
TypeScript types at all. So the third option is what a lot of teams actually do: spend two months
building one.

FluxGantt is an attempt at the missing option. The part I'd most like feedback on is the
architecture rather than the feature list:

**The engine is headless.** `createGantt()` imports no DOM API. It holds the task store, the
dependency graph, the working-calendar math and the critical-path solver, and it runs in Node, in a
Worker, or in a test with no jsdom. That configuration is 7.7 KB gzip. Rendering is something you
opt into.

**Capabilities are separate subpath exports, not methods on a class.** This was the single most
useful thing I learned building it: class prototype methods can never be tree-shaken, so a
monolithic `Gantt` facade bills every consumer for the renderer, the drag handlers and the CSV
exporter whether they call them or not. Splitting the facade into a base plus opt-in mixins
(`withRender`, `withInteraction`, `withIo`, `withTheme`, `withResponsive`) took hello-world from
22.3 KB to 7.7 KB without deleting a single feature. An editable chart is 19.2 KB. Everything
composed is 23.8 KB. Those budgets fail CI if exceeded.

**All date math goes through the Temporal API**, never native `Date`. A Gantt chart is date
arithmetic wearing a UI, and native `Date` gets DST transitions and timezones wrong in ways that
surface as a task silently sliding by an hour. The test suite runs across `America/New_York`,
`Asia/Ho_Chi_Minh` and UTC, and across DST boundaries.

**Required host CSS: none.** Every visual property is written inline with a `--fg-*` custom-property
fallback, so the chart paints correctly with zero stylesheet imports and you add CSS only to
override. This is also why the size comparison above includes the competitors' stylesheets — a
chart that doesn't paint isn't a fair number.

**TypeScript is the source of truth, not a `.d.ts` afterthought.** IDs are branded, so passing a
`ResourceId` where a `TaskId` belongs is a compile error rather than a production incident.

What it does today: FS/SS/FF/SF dependencies with lag/lead, hierarchy with summary rollup, critical
path (CPM), a DST-correct working calendar, drag to move/resize/link, keyboard navigation, an ARIA
`treegrid` targeting WCAG 2.1 AA, light/dark theming, touch-adapted layout, JSON/CSV/SVG/PNG
import-export, and React and Vue wrappers. Canvas takes over from SVG automatically above 2,000
tasks.

What it doesn't: resource leveling, baselines, task constraints and MS Project XML are planned for a
paid Pro tier — worth saying plainly, since dhtmlx Community ships MS Project I/O for free today.
No Svelte or Angular wrapper yet. No pinch-to-zoom. The core is and stays MIT.

I'd particularly like to hear from anyone who has embedded a Gantt in a product and hit the limits
of one of the existing libraries — I'd rather find out now which of my assumptions about what
matters are wrong.

---

## Notes for the maker comment / replies

Prepared answers for the questions this post will get. Keep them honest; every number below is
re-measurable from the repo.

**"Another Gantt library?"** — Yes, and the differentiator is deliberately not the feature list,
which dhtmlx wins. It's that the engine is separable from the DOM and the bytes are budgeted in CI.

**"How does it compare to Frappe?"** — Frappe is smaller (14.9 KB vs 19.2 KB for an editable chart)
and simpler. Link the comparison page and *lead with Frappe winning that row*. Anyone who checks
will find it out in thirty seconds; saying it first is the only position that survives scrutiny.

**"Is the 7.7 KB number real?"** — It's `pnpm size` output on a bundled, tree-shaken, gzipped
fixture that mounts nothing, and it's enforced on every PR. It is genuinely the headless
configuration and genuinely not a chart. An editable chart is 19.2 KB; that's the number to quote if
someone accuses the small one of being cherry-picked — because it is a fair accusation about a
library people want for its UI.

**"How did you measure the competitors?"** — `tooling/scripts/measure-competitor-bundles.mjs`, which
`npm pack`s each library at a pinned version and gzips its own advertised entry point plus its
stylesheet. Bryntum is deliberately absent: its npm package is a 13 KB placeholder and the real
bundle is behind a login, so there's nothing anyone can independently re-measure.

**"Why not just use a charting library?"** — A Gantt is a scheduler that happens to draw bars. The
hard part is CPM, cascade, working-calendar arithmetic and DST, none of which a charting library has.

**"Is the licensing a bait-and-switch?"** — The core is MIT and stays MIT. Pro is a one-time
purchase, not a subscription, precisely because paying rent for a library is miserable. Nothing
currently MIT will move behind the paywall.

**"Pre-1.0 — will you maintain it?"** — Point at the CI: unit, e2e, visual-regression, a11y, mobile
and performance suites, plus the size budgets. Don't promise a roadmap date you can't hit.
