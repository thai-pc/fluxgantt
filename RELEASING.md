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
