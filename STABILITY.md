# FluxGantt stability policy (0.x)

FluxGantt follows semver with the usual 0.x reading: the **minor** number carries breaking
changes, the **patch** number never does. On top of that, every exported symbol carries a tier, so
you can tell which breaking changes to expect and which to rule out.

## What counts as public API

Everything exported from a documented entry point (`@fluxgantt/core`, `@fluxgantt/core/<subpath>`,
`@fluxgantt/react`, `@fluxgantt/vue`) and recorded in that package's `etc/*.api.md` report:
functions, classes, types, constants, event names and payloads, config fields, error class names
and documented error fields. The **order and cardinality of events per mutation**, as pinned by the
golden event-log tests, is also public.

Not public:

- anything that is not exported, and anything reached by a deep import (the `exports` map blocks it);
- error message text (match on the error `name` and its documented fields);
- CSS class internals not documented in the theming guide;
- exact bundle bytes (the size budgets are a CI goal, not an API promise).

## Tiers

Every exported symbol is in exactly one tier. The tier is a TSDoc tag in the source and shows in
the committed API reports as `// @public`, `// @beta` or `// @deprecated`.

| Tier | Tag | Meaning |
|---|---|---|
| Stable | none (`@public`) | Changes follow the rules below. |
| Experimental | `@beta` | May change or be removed in **any minor** release without a deprecation window. Every such change is announced in the changeset with a `Beta:` line. A patch release never changes it. |
| Deprecated | `@deprecated` | Still works. Removed no earlier than **two minor releases and 30 days** after the release that deprecated it. The tag names the replacement, or says there is none. |

`@beta` is the machine tag; "experimental" is the word we use in prose. A symbol that is both
`@deprecated` and `@beta` was exported by accident (an internal helper that leaked through a
barrel); it keeps working for the deprecation window and is then removed.

`@internal` is used for a few members of public classes that the library itself needs (for example
`TaskStore.subtree` and `DependencyStore.linkAll`). They are not part of the API. API Extractor's
`@internal` convention asks for an underscore-prefixed name, but renaming a member of an exported
class would itself be a breaking change, so the tag stays and the rule for top-level exports is
enforced instead. Do not call `@internal` members.

## What a release may change

**Patch releases** may fix bugs (including behaviour that contradicted the docs), improve
performance, and change internals, docs and comments. They must not change any `etc/*.api.md`
report.

**Minor releases** may:

- add exports, optional fields, events, subpaths, and union members that appear only in output
  positions (event payloads, results);
- change or remove experimental symbols;
- remove deprecated symbols past their window;
- make a breaking change to stable API **only** to fix a security issue or to correct a violation
  of documented behaviour.

Every breaking change is marked `BREAKING:` as the first line of its changeset, with a migration
note, and is listed under its own heading in `CHANGELOG.md`.

**Hosts must** keep a `default` branch in exhaustive switches over output-position unions
(`ConflictKind`, announcement kinds, event names). Adding a member there is not a breaking change.
For the same reason, a host that keeps an exhaustive `Record<GanttEventName, ...>` can break when a
minor adds an event.

## New API soaks first

New public surface ships as experimental (`@beta`) in its first minor release and is promoted to
stable in the next minor if it is unchanged.

## Carve-outs

These may change in a minor release even though the symbol is stable:

- **C1.** Types that expose `@js-temporal/polyfill`. A move to native `Temporal` types will be
  announced in advance.
- **C2.** The SVG/Canvas DOM structure and `fg-` class names beyond what the theming guide
  documents.

## Wrappers

`@fluxgantt/react` and `@fluxgantt/vue` follow the same tiers for their own symbols. Types they
re-export from core carry core's tier.

## How it is enforced

CI regenerates API Extractor reports for every entry point and fails if they differ from the
committed ones. A PR that changes a report must carry a changeset for that package with at least a
`minor` bump, and a changeset line starting `BREAKING:` or `Beta:` when it removes or alters a
declaration. A public (`@public`) declaration whose signature references a `@beta` type is recorded
in the report as an `ae-incompatible-release-tags` warning, so the exposure is visible and reviewed
rather than silent. See [`CONTRIBUTING.md`](./CONTRIBUTING.md#changing-the-public-api).

## Criteria for 1.0

1. Zero `@beta` and zero `@deprecated` symbols in every report. Each former beta symbol is
   promoted, moved behind an explicitly experimental subpath, or removed.
2. At least three consecutive minor releases and 90 days with additive-only report diffs.
3. The performance and correctness work on the critical path, batched mutation and indexed stores
   is closed, and the critical path is validated against a reference tool with constraint
   resolution wired through the instance.
4. The mutation/command layer is decided: shipped, or explicitly deferred as additive for 1.x.
5. The Temporal type decision (polyfill types or native) is made and documented, because it sits
   on the public surface (carve-out C1).
6. The docs site is deployed, with a migration guide from 0.x and an API page for every stable
   symbol.
7. Wrapper reports are clean (no `@beta`) and wrapper peer ranges are stated.
8. A support matrix (browsers, Node, minimum TypeScript) is published and the
   [`SECURITY.md`](./SECURITY.md) process has been exercised once.
9. `attw` and `publint` are clean for the dual ESM/CJS package.
