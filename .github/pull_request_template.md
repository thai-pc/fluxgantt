## What and why

<!-- What changes, and what problem it solves. Link the issue if there is one. -->

## How

<!-- The approach, and anything a reviewer would otherwise have to reverse-engineer from the
diff: a trade-off taken, an alternative rejected, a constraint that forced the shape. -->

## Verification

<!-- What you ran, and what it said. Paste real output rather than asserting it passed. -->

## Checklist

- [ ] Tests added or updated (`.claude/rules/testing.md` — the compute layer is the priority).
- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass locally.
- [ ] **Changeset added** (`pnpm changeset`) if a published package changed. Changes scoped
      entirely to `apps/*`, `examples/*` or tooling need none.
- [ ] **Bundle budgets** still green (`pnpm size`) if this touches `packages/core`. Prefer
      changing the shape over raising a budget — see CLAUDE.md golden rule 5.
- [ ] **Security** reviewed if this touches IO, parsing, rendering of host data, or anything
      cloud/AI (`.claude/rules/security.md`): no user string interpolated into markup, imports
      schema-validated, no secret in code or logs.
- [ ] Visual baselines unchanged, or the change is intended and explained.
- [ ] Docs updated (`apps/docs/pages/`, and the spec if the public API changed).
