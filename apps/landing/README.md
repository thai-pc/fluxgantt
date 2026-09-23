# apps/landing — intentionally empty

Spec §11's tree reserves this directory for a "marketing landing page (Next.js or Astro)". It holds
no app, and that is a decision rather than unfinished work.

**The landing page is `apps/docs/pages/index.mdx`.** Vocs renders it at the site root with the
hero, the "Why FluxGantt" section, the comparison table, the tiers and the quick start — which is
everything a separate marketing app would contain. Building a second app would mean two deployments,
two navigations, and two copies of the bundle-size and comparison numbers to keep in sync. Those
numbers are measured (`pnpm size`, `tooling/scripts/measure-competitor-bundles.mjs`) and they change
whenever the budgets move, so a second copy would go stale and contradict the first.

Revisit this when one of these is actually true:

- The marketing site needs something Vocs cannot render — a waitlist form with a backend, pricing
  checkout, or a Product Hunt/launch campaign page.
- Pro-tier pricing goes live (spec §9.2 lists a "Pro tier landing page"), at which point commerce
  pages genuinely do not belong in a docs site.

Until then, edit `apps/docs/pages/index.mdx`.
