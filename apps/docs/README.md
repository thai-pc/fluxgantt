# FluxGantt docs site

The FluxGantt documentation + landing site, built with [Vocs](https://vocs.dev). Its home page
doubles as the marketing landing page. Content lives in `pages/` (`rootDir: '.'` in
`vocs.config.ts`).

## Develop

```bash
# from the repo root
pnpm install
pnpm build                 # build the workspace packages the docs snippets reference
pnpm --filter docs dev     # start the docs dev server
pnpm --filter docs build   # static build → apps/docs/dist
```

## Structure

```
apps/docs/
  vocs.config.ts     # site config: title, sidebar, topNav, theme (indigo accent)
  pages/
    index.mdx        # Home / landing
    docs/
      installation.mdx
      quick-start.mdx
      concepts/*.mdx
      interactions/*.mdx
      import-export.mdx
      frameworks/{react,vue}.mdx
      api.mdx
      theming.mdx
```

Every code snippet is written against the real `@fluxgantt/{core,react,vue}` API. The
quick-start snippet is single-sourced from `examples/plain-html-demo/src/main.ts` and verified
by `tooling/scripts/check-snippet-sync.mjs`.

## Deploy (config ready, not wired to a live account here)

The site builds to a static `apps/docs/dist`, deployable to any static host. Recommended:
**Vercel**, one project with the monorepo root as the install context.

- **Root directory:** `apps/docs`
- **Install command:** `pnpm install` (run at the monorepo root — Vercel detects the pnpm
  workspace)
- **Build command:** `cd ../.. && pnpm turbo run build --filter=docs`
- **Output directory:** `apps/docs/dist`
- **Deploy trigger:** on merge to `master` (Vercel's default git integration). PR previews are a
  free side benefit.

No secrets/tokens are committed. Connect the repo through Vercel's GitHub App at deploy time;
that is a repo-owner step intentionally left out of the codebase.

Alternative (GitHub Pages): build with `pnpm --filter docs build` in CI and publish
`apps/docs/dist` with `actions/deploy-pages` — again, wiring the live deploy is a repo-owner
step. CI here only *build-checks* the site (see `.github/workflows/ci.yml`).
