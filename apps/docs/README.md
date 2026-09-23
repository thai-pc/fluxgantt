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

## Deploy

The site is deployed to **GitHub Pages** at https://thai-pc.github.io/fluxgantt by
`.github/workflows/docs-deploy.yml`.

- **Build:** `pnpm --filter docs build` — `vocs build` followed by
  `tooling/scripts/finalize-pages-build.mjs`.
- **Artifact:** `apps/docs/dist/public` (22 HTML files). Not `dist/` — that also contains an SSR
  server bundle the static deploy does not use.
- **Trigger:** `workflow_dispatch` (run **Deploy docs** from the Actions tab).

Three settings in `vocs.config.ts` are what make this work, and none is optional:

| Setting | Why |
|---|---|
| `renderStrategy: 'full-static'` | Vocs defaults to `'dynamic'`, which emits an SSR server and **zero HTML**. `finalize-pages-build.mjs` fails the build if that ever regresses. |
| `basePath: '/fluxgantt'` | Pages serves from the repository sub-path, so every asset and internal link needs the prefix. |
| `baseUrl: 'https://thai-pc.github.io'` | Origin **only** — Vocs composes canonicals as `baseUrl + basePath + pathname`, so including the sub-path here would double it. |

`sitemap` is off deliberately: Vocs generates sitemap entries as `siteUrl + pagePath`, omitting
`basePath`, which under a sub-path deployment would list URLs that 404.

`finalize-pages-build.mjs` also writes `.nojekyll`. Pages runs Jekyll by default and Jekyll drops
paths beginning with `_`, which is exactly what waku's `encodeRscPath()` emits (`RSC/R/_root.txt`,
`_root.d/`) — without it, client-side navigation 404s on the live site while working locally.

### Previewing the built site

Serve it under the real sub-path, or basePath bugs stay invisible:

```bash
pnpm --filter docs build
mkdir -p /tmp/pages-preview && cp -R apps/docs/dist/public /tmp/pages-preview/fluxgantt
cd /tmp/pages-preview && python3 -m http.server 8099
# http://localhost:8099/fluxgantt/
```

`pnpm --filter docs preview` serves at `/` instead, so it cannot catch those.
