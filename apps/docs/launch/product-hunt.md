# Product Hunt launch assets — draft

Not published. Spec §9.1 and §15.2 call for Product Hunt assets: maker comment, screenshots,
gallery, video.

**What is in this file:** every text asset, written and ready to paste.

**What is not, and cannot be:** the images. The gallery, the thumbnail, the three demo GIFs and the
video are binary media that have to be captured from a running browser. This file specifies each
one precisely enough to hand to whoever captures them — including exact viewport sizes and which
example page to record — but it does not and cannot contain them. Do not treat this file as the
asset set being complete.

**Timing** per §15.2: Tuesday–Thursday, 00:01 PT (PH days start at midnight Pacific, so posting
later costs you hours of ranking).

**Prerequisite:** same as Show HN — packages published to npm, docs site deployed. A Product Hunt
launch pointing at an uninstallable package converts nothing.

---

## Listing copy

**Name:** FluxGantt

**Tagline** (60 characters max — this is the hard one):

> `The MIT Gantt library with a 7.7 KB headless core` — 48 chars

> `TypeScript-first Gantt charts. MIT. 7.7 KB headless core.` — 56 chars

> `Open-source Gantt charts for developers who count bytes` — 54 chars

Recommend the first.

**Links:** docs site as primary; GitHub repo as secondary.

**Topics:** Developer Tools · Open Source · Productivity · Design Tools

---

## Description (260 characters max)

> An MIT-licensed Gantt chart library for TypeScript apps. The scheduling engine is headless — 7.7 KB
> gzip, runs in Node — and rendering, drag, theming and export are opt-in. FS/SS/FF/SF dependencies,
> critical path, DST-correct dates. No per-seat license.

254 characters.

---

## Maker comment

Post this yourself in the first minutes; it is the thing people actually read.

> Hi Product Hunt 👋
>
> I built FluxGantt because every time I needed a Gantt chart in a product, the options were: pay
> $600–1,600 per developer per year for dhtmlx or Bryntum, pull in a 226 KB MIT monolith, use
> something with no TypeScript types and no critical path, or spend two months building one. None of
> those felt like they should be the whole menu in 2026.
>
> The decision the whole library hangs on is that the **engine is headless**. `createGantt()` imports
> no DOM API — it's the task store, the dependency graph, the working-calendar math and the
> critical-path solver, and nothing else. That's 7.7 KB gzip and it runs on your server. Rendering,
> drag interactions, theming, touch adaptation and import/export are separate opt-in imports, so you
> download what you compose. An editable chart is 19.2 KB; everything composed is 23.8 KB. Those are
> CI-enforced budgets, not aspirations.
>
> Two details I'm oddly proud of:
>
> **Every date calculation goes through the Temporal API, never `Date`.** A Gantt chart is date
> arithmetic wearing a UI, and native `Date` mishandles DST in ways that show up as a task quietly
> shifting an hour. Tests run across three timezones and over DST boundaries.
>
> **Zero required CSS.** Every visual property is written inline with a custom-property fallback, so
> the chart paints correctly with no stylesheet at all and you add CSS only to override.
>
> It's MIT and stays MIT. Resource leveling, baselines and MS Project import are planned as a
> one-time-purchase Pro tier — one-time, because paying annual rent for a library is miserable.
>
> Honest caveats: it's pre-1.0, there's no Svelte or Angular wrapper yet, and if you need resource
> leveling today dhtmlx or Bryntum will serve you better. I'd genuinely rather hear that from you now
> than discover it in six months.
>
> Happy to answer anything about the architecture — especially the facade split, which is the part I
> got wrong twice before getting right.

---

## Image assets — specification for capture

None of these exist yet. Capture each from a local `pnpm --filter plain-html-demo dev`.

### Thumbnail — 240×240 PNG

The FluxGantt mark on `#6366f1` indigo (spec §8.1), or a tightly cropped three-bar chart fragment
with one bar showing its dashed-red critical-path outline. Must stay legible at 40×40, which is the
size it is actually shown at in the feed.

### Gallery — 1270×760 PNG, first image is the one that matters

1. **The chart itself.** `/` at 1270×760, window at that exact size so there is no scaling. A
   populated project with visible hierarchy, dependency arrows and a dashed-red critical path. No
   browser chrome, no devtools.
2. **The bundle-size table.** The comparison page's size table as a clean screenshot, or a rendered
   bar chart of 7.7 / 19.2 / 23.8 KB against 226 KB (dhtmlx) and 14.9 KB (Frappe). **Include the
   Frappe bar.** Omitting the one competitor that beats a FluxGantt row is the kind of thing a
   developer audience catches and punishes.
3. **TypeScript DX.** An editor screenshot of the branded-ID compile error from the comparison page —
   `Argument of type 'ResourceId' is not assignable to parameter of type 'TaskId'` — with the red
   squiggle visible. This single image makes the TypeScript argument better than a paragraph does.
4. **Touch/responsive.** `/responsive.html` in Pixel 5 device emulation (393×851), showing the
   narrowed label column and the larger link handles.
5. **Headless code.** The 7-line `createGantt()` + `computeCriticalPath()` snippet from the examples
   page, syntax-highlighted, on a dark background.

### The three demo GIFs — required by spec §15.1

Capture at 1200×675, ≤8 seconds each, ≤5 MB, looping, no cursor trails.

| GIF | Page | What to record |
|---|---|---|
| Drag a task | `/` | Grab a bar mid-body, drag it several days later, release. Show the bar snapping to the grid. |
| Dependency cascade | `/` | Drag a predecessor bar and let its successors shift with it — this is the one that communicates "scheduling engine" rather than "bar chart". |
| Critical path | `/` | Drag a bar until the dashed-red critical path visibly re-routes through a different chain. |

Spec §15.1 lists the third GIF as "AI scheduling". **Substitute critical path.** AI scheduling is
Wave 3 and does not exist; a GIF of it would be a fabrication.

### Video — optional, 60–90 seconds

Screen recording, voiceover, no music. Beat sheet: the problem (the price and the 226 KB) → the
headless snippet running in a terminal with no browser → `mount()` and the chart appears → one drag
with the cascade → the CI size-budget check going green. End on the install command.

---

## First-day replies to have ready

**"How is this different from Frappe Gantt?"** — Critical path, all four dependency types, working
calendar, TypeScript types, React/Vue wrappers, Canvas at scale. And say the other half: Frappe is
smaller, 14.9 KB against 19.2 KB. Link the comparison page.

**"Why should I trust a pre-1.0 library?"** — Point at CI: unit, e2e, visual-regression, a11y, mobile
and performance suites plus enforced size budgets, all public.

**"Will the free version get crippled?"** — No. Everything MIT today stays MIT. Pro adds resource
leveling, baselines, constraints and MS Project XML — features that do not exist in the free tier
today and so cannot be taken out of it.

**"Does it do resource management?"** — Not yet; that's the Pro tier and it isn't built. If you need
it today, dhtmlx Community ships MS Project I/O for free and Bryntum has the most complete resource
view. Say so.
