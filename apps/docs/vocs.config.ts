import { defineConfig } from 'vocs/config';

// FluxGantt docs + landing site. `rootDir: '.'` makes Vocs read pages from `apps/docs/pages`
// (its default rootDir is `docs`, which would nest awkwardly since this app already lives at
// `apps/docs`). `srcDir: '.'` matches: Vocs 2.x defaults to `<rootDir>/src/pages`, but pages
// here live directly under `<rootDir>/pages` (no `src/` nesting). Visual identity mirrors the
// design tokens in `apps/docs/fluxgantt-spec.md` §8.2: indigo #6366f1 as the accent (lightened
// to #818cf8 for dark-mode contrast).
export default defineConfig({
  rootDir: '.',
  srcDir: '.',
  title: 'FluxGantt',
  description: 'The Modern MIT-Licensed Gantt Chart Library — TypeScript-first, headless, framework-agnostic.',
  titleTemplate: '%s · FluxGantt',
  accentColor: 'light-dark(#6366f1, #818cf8)',
  // Vocs 2.x dropped the `font.google` shorthand; load the Google Font via a head <link> instead.
  head: {
    link: [
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: 'anonymous' },
      { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap' },
    ],
  },
  topNav: [
    { text: 'Docs', link: '/docs/installation' },
    { text: 'API', link: '/docs/api' },
    // Replace <org> with the real GitHub org/user once the repo is public.
    { text: 'GitHub', link: 'https://github.com/thai-pc/fluxgantt' },
  ],
  socials: [
    { icon: 'github', link: 'https://github.com/thai-pc/fluxgantt' },
  ],
  sidebar: [
    {
      text: 'Getting Started',
      items: [
        { text: 'Introduction', link: '/' },
        { text: 'Installation', link: '/docs/installation' },
        { text: 'Quick Start', link: '/docs/quick-start' },
      ],
    },
    {
      text: 'Core Concepts',
      items: [
        { text: 'Tasks', link: '/docs/concepts/tasks' },
        { text: 'Dependencies', link: '/docs/concepts/dependencies' },
        { text: 'Hierarchy', link: '/docs/concepts/hierarchy' },
        { text: 'Critical Path', link: '/docs/concepts/critical-path' },
        { text: 'Working Calendar', link: '/docs/concepts/working-calendar' },
      ],
    },
    {
      text: 'Interactions',
      items: [
        { text: 'Drag & Drop', link: '/docs/interactions/drag' },
        { text: 'Read-only Mode', link: '/docs/interactions/read-only' },
      ],
    },
    {
      text: 'Import & Export',
      items: [{ text: 'JSON, CSV, SVG, PNG', link: '/docs/import-export' }],
    },
    {
      text: 'Frameworks',
      items: [
        { text: 'React', link: '/docs/frameworks/react' },
        { text: 'Vue', link: '/docs/frameworks/vue' },
      ],
    },
    {
      text: 'Reference',
      items: [
        { text: 'API Surface', link: '/docs/api' },
        { text: 'Theming', link: '/docs/theming' },
        { text: 'i18n', link: '/docs/i18n' },
      ],
    },
  ],
});
