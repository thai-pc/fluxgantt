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

## Before the first release

One-time owner setup, none of which can be done from a PR:

- [ ] **Claim the `@fluxgantt` npm scope.** It is currently unclaimed — `npm view @fluxgantt/core`
      returns E404 — which means anyone could take it.
- [ ] **Add the `NPM_TOKEN` repo secret** (an npm *automation* token, so 2FA does not block CI).
- [ ] **Settings → Actions → General → allow "Workflows can create and approve pull requests".**
      Without it `changesets/action` cannot open the version PR.

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

- **`LICENSE` is injected by pnpm** at pack time from the workspace root; per-package copies are
  unnecessary. (Symlinks would not work regardless — `npm pack` does not follow them.)
- **Provenance attestation is off.** changesets spawns `pnpm publish` and builds only
  `--access` / `--tag` / `--no-git-checks`; it never passes `--provenance`. The only lever on this
  path is the `NPM_CONFIG_PROVENANCE` env var, which also needs `id-token: write` on the job.
  Enabling it is a follow-up to verify end to end, not a release gate.
- **`baseBranch` is `master`**, not `main`. Changesets diffs against it; pointing it at a branch
  that does not exist fails every command with
  `Failed to find where HEAD diverged from …`.
