# Releasing

Versions and changelogs are automated by [changesets](https://github.com/changesets/changesets).
Nothing publishes as a side effect of merging ordinary work — the release is always an explicit
act.

## The flow

```
your PR (with a changeset)  ->  master  ->  bot opens "chore: version packages" PR
                                                        |
                                            you merge it  ->  npm publish + git tags
```

1. **Every PR that changes a published package carries a changeset.** `pnpm changeset` — pick the
   packages, pick patch/minor/major, write the line that will appear in the changelog. Changes
   scoped entirely to `apps/*`, `examples/*` or tooling need none (see `CONTRIBUTING.md`).
2. **On merge to `master`,** `.github/workflows/release.yml` runs `changesets/action`. With
   changesets pending it opens — or updates — a PR titled `chore: version packages`. That PR
   consumes the changeset files, bumps versions, and writes each `CHANGELOG.md`. **It publishes
   nothing.**
3. **Merging that PR is the release.** The same workflow then sees a versioned commit with no
   pending changesets and runs `pnpm release` = `turbo run build && changeset publish`, which
   publishes each changed package to npm and pushes a git tag per package.

Reviewing the version PR before merging it is the whole point of the design: it is the last place
to see exactly which versions are about to exist, and to read the changelog as a consumer will.

## Owner setup

Done, recorded here because each one is invisible in the repo and has to be re-done if the org or
the repo is ever recreated:

- [x] **The `@fluxgantt` npm org exists** and owns the scope (2026-09-24). Verify with
      `curl -s -o /dev/null -w '%{http_code}' https://registry.npmjs.org/-/org/fluxgantt/user`
      — 200 means claimed, 404 means gone.
- [x] **`NPM_TOKEN_FLUXGRANTT` repo secret** (an npm *automation* token, so 2FA does not block
      CI). That is the name `release.yml` reads, spelling included — the secret has a transposed
      `GRANTT`. Renaming it to `NPM_TOKEN_FLUXGANTT` is fine, but rename the secret and the
      workflow together: a missing secret resolves to the empty string with no warning, and the
      publish then fails much later with `ENEEDAUTH`.
- [x] **Settings → Actions → General → "Workflows can create and approve pull requests"**, or
      `changesets/action` cannot open the version PR. Set via
      `gh api -X PUT repos/thai-pc/fluxgantt/actions/permissions/workflow -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true`
      — deliberately leaving the token at `read`, because `release.yml` declares the write
      permissions it needs itself.
- [ ] **Settings → Pages → Source = GitHub Actions**, then dispatch **Deploy docs** once and
      review the live site. Still outstanding: `gh api repos/thai-pc/fluxgantt/pages` → 404.

### A note on the bot's version PR

GitHub gates workflows on PRs opened by an app, so the "Version Packages" PR lands with **zero
checks** and a status of `action_required` until someone approves the runs. Approve from the PR's
Checks tab, or:

```bash
gh api -X POST repos/thai-pc/fluxgantt/actions/runs/<run-id>/approve
```

One approval per head commit — pushing a fixup to the bot branch needs another.

### Registry propagation is not instant

`npm view` and a direct `curl` to the registry returned **404 for several minutes** after a
publish that had already succeeded (verified 2026-09-24: the run logged `Successfully published`
at 15:07 UTC, the registry served 200 at ~15:14). Read the run log, not the registry, to decide
whether a publish worked; check the registry afterwards to confirm what consumers get.

## Checking a release before it happens

`changeset status` says what would be bumped:

```bash
npx changeset status
```

To see the exact diff the version PR will contain, do it on a scratch branch and throw it away:

```bash
git switch -c scratch/version-preview
pnpm version-packages
git --no-pager diff --stat
git reset --hard HEAD && git switch - && git branch -D scratch/version-preview
```

To inspect what will actually ship in a tarball — the only reliable way to catch a broken
`exports` map, since the workspace resolves through symlinks rather than through `exports`:

```bash
cd packages/core && pnpm pack --pack-destination /tmp
tar -tzf /tmp/fluxgantt-core-0.1.0.tgz

cd /tmp && mkdir -p consumer-test && cd consumer-test && npm init -y
npm i /tmp/fluxgantt-core-0.1.0.tgz
for s in io render interaction theme responsive; do
  node -e "import('@fluxgantt/core/$s').then(() => console.log('ok $s'))"
done
```

Two limits of that check, worth knowing before you trust a green result:

- **`pnpm pack` is not the publish path.** The release runs `changeset publish`, which spawns
  `pnpm publish` per package directory. `pack` and `publish` share the file-collection code, so
  the *contents* are a faithful preview — but only `publish` applies registry-side rules
  (`publishConfig`, `--access`, the 2FA/token check), and only `publish` can fail on them. A
  clean `pack` says "the tarball is right", never "the publish will succeed".
- **The `dist/` it packs is whatever is on disk.** `pack` runs no build. Run `pnpm build` in the
  package first, or you are inspecting a stale or absent `dist`.

Also worth adding once, if you want the type check a consumer gets: compile a scratch project
against the tarball with `skipLibCheck: false`. The `tsc --init` default is `true`, which hides
every problem in our shipped `.d.ts` files — including the known `@js-temporal/polyfill` type
import (see `packages/core/README.md` for why it stays).

`tooling/scripts/check-publish-readiness.mjs` runs in CI on every PR and asserts the registry
metadata (repository/homepage/bugs/keywords, a README, `CHANGELOG.md` in `files`, and the absence
of `engines.node`, which is a repo build bound rather than a consumer one).

## After a release

```bash
npm view @fluxgantt/core version repository homepage keywords
git fetch --tags && git tag | tail
```

Then read the rendered README on npmjs.com — relative links in it resolve against the registry,
not the repo, so a link that works on GitHub can still be broken there.

## Manual check: pinch zoom on iOS Safari

Not automatable (`simctl` has no multi-touch, Playwright WebKit cannot synthesize a two-finger
touch), so run it by hand before a release that touches `withResponsive()`:

1. `xcrun simctl boot` an iPhone simulator, serve `examples/plain-html-demo` and
   `xcrun simctl openurl booted http://<host-ip>:<port>/responsive.html` (also
   `edit-hooks.html?touch=1&pad=2100` for Canvas).
2. In the Simulator window hold **Option** for a two-finger pinch (Option+Shift moves the pair).
3. Checklist: the chart steps one view mode and the date under the midpoint holds; the page does
   not zoom (`visualViewport.scale` stays 1 in Web Inspector); a pinch started with one finger on
   a bar moves nothing; single-finger pan still scrolls; a pinch with both fingers on the header
   band is a page/browser gesture (expected); rotate and re-check; Canvas fixture.
4. Log whether `gesturestart` fires on the chart. Only if page zoom leaks onto the chart,
   `preventDefault()` `gesturestart`/`gesturechange`/`gestureend` on the container while a pinch
   is active (about +60-80 B gzip) and re-measure `pnpm size`.

## StackBlitz examples

The docs' examples page and the README link four StackBlitz projects (vanilla, React, Vue,
headless) at `https://stackblitz.com/github/thai-pc/fluxgantt/tree/stackblitz/<dir>`. StackBlitz
imports only that folder and installs it with npm, so it cannot open `examples/*` directly
(`workspace:*`, a tsconfig that `extends` outside the folder, Playwright harness pages). Instead:

- **The `stackblitz` branch is generated. Never edit or protect it.** It is a single
  force-pushed commit of standalone copies written by `tooling/scripts/build-stackblitz-examples.mjs`
  (an explicit allow-list of files, `workspace:*` replaced by `^<published version>`, tsconfig
  flattened). Its `.stackblitz-stamp.json` records the source commit and the three versions.
  The in-repo examples stay on `workspace:*` and keep driving Playwright.
- **It refreshes itself after each release.** `.github/workflows/stackblitz-examples.yml` runs
  when `Release` completes. Whether to regenerate is decided by `tooling/scripts/stackblitz-decide.mjs`
  from state, not from the commit diff: it regenerates when the branch's stamp differs from the
  source commit's versions and either that commit is the version bump (it then waits for the
  registry, up to 20 minutes, see the note above) or the versions already resolve on the registry.
  So ordinary master pushes are green no-ops once the branch is current, and a release whose run
  never happened is picked up by the next master push. It never overwrites a stamp that has
  **newer** versions than the source (a no-op, unless `force`). Then it generates with
  `--check-registry` (fails if an example imports a subpath the published version does not export),
  runs `npm install`, `typecheck` and `build` (`npm start` for headless) in a clean directory, and
  only then force-pushes. A failure leaves the branch at the previous release.
- **Jobs and trust.** `generate` runs only first-party, dependency-free Node (decide, generator,
  artifact validation) and uploads the artifact. `verify` downloads it and does the clean-room
  `npm install` (third-party install scripts), with a read token; its output is discarded.
  `push` needs both, downloads **only** `generate`'s artifact (pinned by artifact ID), validates it
  again (`tooling/scripts/validate-stackblitz-artifact.mjs`: no `.git`, no symlinks, no hidden or
  unexpected entries) and commits it with a git directory outside the tree and a fresh config.
- **Retrying:** "Re-run all jobs" on the failed run, or **Actions → StackBlitz examples → Run
  workflow** with `source_ref` = the release commit, its `@fluxgantt/<pkg>@x.y.z` tag, or `master`
  (`force` regenerates even when the stamp already matches, or is newer). `source_ref` must be a
  branch or tag of this repo, or a commit on `master`; `refs/pull/*` is refused. The source ref
  must contain the generator and the decide script, so nothing before them can be dispatched.
  Runs are serialised by a `concurrency` group, and GitHub keeps only one **pending** run per
  group: a newer run replaces a pending one. That is harmless, because the decision is state-based
  and the next run catches up.
- **Not bootstrapped (decided 2026-10-15).** The branch does not exist yet, so **every
  StackBlitz link in the docs and README returns a 404 until the next release.** The examples
  now import `@fluxgantt/core/viewport`, which `core@0.2.1` does not export, so the generator
  refuses to build them against the current npm versions; the next release publishes that subpath
  and its run populates the branch. Until the branch exists, only a version-bump commit or a
  dispatch creates it (an ordinary master push is a no-op), so the runs stay green meanwhile.
- **PR-time check:** the `stackblitz-examples` job in `ci.yml` does the same clean-room install,
  typecheck and build against `pnpm pack` tarballs of the PR's packages, and `check-stackblitz-links.mjs`
  asserts every link targets the `stackblitz` branch, a generated folder and a generated `?file=`.

Reproduce locally (outside the repo, since npm must not see the workspace):

```bash
pnpm exec turbo run build --filter=@fluxgantt/core --filter=@fluxgantt/react --filter=@fluxgantt/vue
pnpm --filter @fluxgantt/core --filter @fluxgantt/react --filter @fluxgantt/vue exec pnpm pack --pack-destination /tmp/fg-tgz
node tooling/scripts/build-stackblitz-examples.mjs --out /tmp/fg-sb/out --versions local-tarballs=/tmp/fg-tgz
node tooling/scripts/verify-stackblitz-examples.mjs /tmp/fg-sb/out --work /tmp/fg-sb/work
# what the release run checks instead (registry versions + published subpaths):
node tooling/scripts/build-stackblitz-examples.mjs --out /tmp/fg-sb/registry --check-registry
```

**One-time manual gate after the first generated release.** The automated checks prove the
copies install and build with Node, not that StackBlitz's WebContainers run them. Whether Vite 8
(Rolldown and lightningcss, native addons with wasm fallbacks) boots there is **unverified**. Open
each of the four links once in **Chrome, Firefox and Safari** and confirm the chart renders and a
drag works; record the result here. Safari matters most: it has no native Temporal, so it is the
browser that proves the examples' `src/temporal.ts` polyfill bootstrap works.

Result for the 0.3.0 release (2026-10-16, automated via Playwright 1.63; Vite 8.3.4 booted, so no
Vite 7 pin is needed; the drag was not exercised):

- Chrome: [x] vanilla · [x] React · [x] Vue · [x] headless (prints the critical path)
- Firefox (WebContainers beta): [x] vanilla · [x] React · [x] Vue · [x] headless, on real Firefox
  158 driven by geckodriver 0.37.1 (2026-10-16, branch stamp core 0.3.1 / react 0.3.0 / vue 0.3.0;
  the chart's SVG and task rows rendered in the in-editor preview and in a second tab). Playwright's
  Firefox build only passes headless: its WebContainer preview stays on `.localservice@no-server`
  (blank) for all three UI examples, so do not use it for this check. StackBlitz's first load
  sometimes stalls at "Cloning repo" and needs a retry. Chart header day labels overlap at the
  default narrow width in real Firefox (not compared against Chrome)
- Safari: [x] vanilla · [x] React · [x] Vue · [x] headless, on real Safari 26.6.2 driven by
  `safaridriver` (2026-10-16, core 0.3.1 / react 0.3.0 / vue 0.3.0): the chart rendered and a bar drag
  moved a task by two days in all three UI examples. Safari 26.6.2 has no native Temporal, so this also
  proves the `src/temporal.ts` bootstrap. Playwright cannot drive real Safari; enable Safari →
  Settings → Developer → "Allow remote automation" to use `safaridriver`. WebContainers for Safari are
  beta and the first clone can stall for 6+ minutes; retry before filing a bug.

If Vite fails to boot, pin the Vite 7 line for the generated copies only, in
`DEPENDENCY_OVERRIDES` at the top of the generator (the comment there names the keys), then
dispatch the workflow with `force`. Every vanilla, React and Vue entry imports `./temporal.js`
first, which installs `@js-temporal/polyfill` as `globalThis.Temporal` only where the browser has
no native Temporal, so the copies do not depend on the visitor's browser.

## Notes

- **Each package carries a real `LICENSE`,** and `files` lists it explicitly. pnpm does inject the
  workspace-root LICENSE at pack time — verified by packing `@fluxgantt/core` before the copies
  existed and finding `package/LICENSE` in the tarball anyway — so the copies are redundant *for
  pnpm*. They are there because shipping an MIT library whose license text depends on which
  packer ran is the one outcome with no acceptable failure mode: `changeset publish` spawns
  `pnpm publish` today, and would stop injecting the moment anyone published with plain `npm`.
  Having both is not double: pnpm does not add a second copy when the file is already present
  (checked — one `LICENSE` entry in the tarball, not two). Note the copies must be **real files**;
  `npm pack` does not follow symlinks.
- **Provenance attestation is off.** changesets spawns `pnpm publish` and builds only
  `--access` / `--tag` / `--no-git-checks`; it never passes `--provenance`. The only lever on this
  path is the `NPM_CONFIG_PROVENANCE` env var, which also needs `id-token: write` on the job.
  Enabling it is a follow-up to verify end to end, not a release gate.
- **`baseBranch` is `master`**, not `main`. Changesets diffs against it; pointing it at a branch
  that does not exist fails every command with
  `Failed to find where HEAD diverged from …`.
