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

The site is hosted on **Cloudflare Pages** at https://fluxgantt.thai-pc.com, through Cloudflare's
Git integration: every push to `master` deploys, and every PR gets a preview URL on `*.pages.dev`.
There is no deploy workflow in `.github/`; the dashboard settings live in `RELEASING.md` →
Docs site. A broken docs build still fails PRs, because `ci.yml`'s `pnpm build` builds this app.

- **Build:** `pnpm --filter docs build` — `vocs build` followed by
  `tooling/scripts/finalize-pages-build.mjs`, which only validates the output (see below).
- **Output:** `apps/docs/dist/public` (23 HTML files). Not `dist/` — that also contains an SSR
  server bundle the static deploy does not use.

Three settings in `vocs.config.ts` are what make this work:

| Setting | Why |
|---|---|
| `renderStrategy: 'full-static'` | Vocs defaults to `'dynamic'`, which emits an SSR server and **zero HTML**. |
| `baseUrl: 'https://fluxgantt.thai-pc.com'` | Canonicals, `og:url`, `sitemap.xml` and `robots.txt` are built from it. No `basePath`: the site is served from the domain root. |
| `head.base: false` | Vocs otherwise emits `<base href="${baseUrl}">`, which points every root-relative asset at production — a preview deploy or a local serve would then run production's scripts. |

`finalize-pages-build.mjs` fails the build if there is no HTML, if a `basePath` is set, if a page
carries an absolute `<base href>`, or if any `/assets/...` URL a page references is missing from
the output.

Vocs emits `pages/docs/x.mdx` as `docs/x/index.html`, so Cloudflare answers `/docs/x` with a 308 to
`/docs/x/`. Client-side navigation uses the slash-less form and works either way.

### Previewing the built site

`wrangler pages dev` is the closest local stand-in for Cloudflare (same trailing-slash redirects
and `404.html` handling). It runs entirely locally and needs no Cloudflare login:

```bash
pnpm --filter docs build
npx wrangler@4 pages dev apps/docs/dist/public --port 5240
# http://127.0.0.1:5240/
```

`python3 -m http.server 5240 -d apps/docs/dist/public` also works for a quick look.
