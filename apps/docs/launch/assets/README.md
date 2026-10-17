# Launch assets

Captured media for the Product Hunt and Show HN launches (spec §9.1 Week 8, §15.1). Specified in
[`../product-hunt.md`](../product-hunt.md); nothing here has been posted anywhere.

**Why here and not `apps/docs/public/`:** these files are uploaded to Product Hunt / Hacker News /
X by hand and are never referenced by a docs page, so serving them from the GitHub Pages site would
only add ~1.7 MB to every deploy. They live next to the copy that specifies them. If a docs page
ever needs one, copy it into `apps/docs/public/` at that point rather than moving the source.

| File | Size | What it is |
|---|---|---|
| `drag-task.gif` | 110 KB | 1200x675, ~6 s loop. Real mouse drag of "Write docs" 6 days later, snapping to the day grid. |
| `dependency-cascade.gif` | 114 KB | 1200x675, ~6 s. Drag "User research" 4 days later in `schedulingMode: 'auto'`; Wireframes, Frontend, API, QA and the Launch milestone are pushed. |
| `critical-path.gif` | 117 KB | 1200x675, ~6 s. Resize "API integration" (right edge) until its chain is the longest; the dashed-red critical path re-routes from Frontend build to API integration. |
| `demo-teaser.mp4` | 259 KB | 1920x1080 H.264, ~18 s, silent: the three GIFs back to back. **Not** the optional 60-90 s voiceover video from the spec. |
| `gallery-1-chart.png` | 67 KB | 1270x760. The chart, light theme (gallery image 1). |
| `gallery-1b-chart-dark.png` | 68 KB | 1270x760. Same chart, dark theme (extra, not in the spec's five). |
| `gallery-2-bundle-size.png` | 113 KB | 1270x760. Bar chart of FluxGantt (measured by the script) against dhtmlx and Frappe (`/docs/comparison` figures), **Frappe included**. |
| `gallery-3-typescript.png` | 257 KB | 1270x760. The branded-ID compile error; the message is real `tsc` output. |
| `gallery-4-responsive.png` | 260 KB | 1270x760. `/responsive.html` in Pixel 5 emulation (393x851, touch, DPR 2), zoomed to `quarter` and scrolled so three bars, their arrows and the enlarged link handles show, in a frame. |
| `gallery-5-headless.png` | 172 KB | 1270x760. The headless `createGantt()` + `computeCriticalPath()` snippet, dark. |
| `thumbnail.png` | 8 KB | 240x240. Three-bar fragment with one dashed-red critical bar on indigo `#6366f1`. |

Sizes are as of the last run; the script prints exact ones.

## Regenerate

```bash
pnpm install
pnpm --filter @fluxgantt/core build
pnpm exec playwright install chromium     # once
pnpm capture:launch-assets                # needs ffmpeg on PATH and Node >= 22.19
pnpm capture:launch-assets -- --copy-only # only re-measure sizes + rewrite the copy (fast, no browser)
```

The script is [`tooling/scripts/capture-launch-assets.mjs`](../../../../tooling/scripts/capture-launch-assets.mjs).
It starts the `plain-html-demo` Vite dev server on `LAUNCH_PORT` (default 5187) unless one is
already answering there, and writes here (override with `OUT_DIR`).

### Where the size numbers come from (one place)

Each run measures the real size-limit fixtures (`size-limit --json`, the measurement CI enforces),
converts gzip bytes to KiB, and uses that single result for both the media (gallery-2 bars,
gallery-5 caption) and the copy. Prose carries invisible markers that the script rewrites in place:

```text
Markdown: <!--sz:editable.2-->19.02<!--/sz-->     MDX: {/*sz:editable.2*/}19.02{/*/sz*/}      (key.decimals)
```

Files synced: `README.md`, `apps/docs/pages/index.mdx`, `apps/docs/pages/docs/{comparison,examples}.mdx`,
`apps/docs/launch/{product-hunt,show-hn}.md`. "- N chars" candidate lines are re-counted. The two competitor
figures (dhtmlx 226.18, Frappe 14.89 KiB) are constants in the script, from
`tooling/scripts/measure-competitor-bundles.mjs`. **Not synced:** literals inside code blocks (the
`// 7.50 KiB, no renderer` comment in `comparison.mdx`) and the "254 characters" line under the
Product Hunt description; re-check both by hand after a size change.

### How the GIFs are produced

Every gesture is real `page.mouse` input, but the output is not a screen recording. A 2x-DPR
screenshot is taken after each mouse step and ffmpeg downscales to 1200x675 with a per-GIF palette,
so text is crisp and timing does not depend on machine speed. Headless Chromium draws no OS
cursor, so an arrow element follows the real mouse events. Output is deterministic in content, not
byte-for-byte.

## Things worth knowing

- The GIFs record `examples/plain-html-demo/launch.html`, not `/`. The quick-start page runs in the
  default `manual` scheduling mode, where dragging a predecessor leaves a dependency violation
  instead of pushing the successor, so it cannot show a cascade. `launch.html` is the same stack
  with `schedulingMode: 'auto'` and a 9-task project. It is dev-only (not a Vite build input).
- The critical-path GIF is a **resize**, not a move. The critical path is computed from durations
  and dependencies, not from where a bar sits on the calendar, so moving a bar never re-routes it.
- Gallery 4 does not show task names: the label column scrolls with the content (it is not
  sticky), and the dataset is five months wide, so showing several bars means scrolling past it.
