# Security Policy

## Supported versions

FluxGantt is pre-1.0. Only the latest release of each `@fluxgantt/*` package receives security
fixes; there are no maintained release branches yet.

| Package | Supported |
|---|---|
| `@fluxgantt/core` | latest release |
| `@fluxgantt/react` | latest release |
| `@fluxgantt/vue` | latest release |

## Reporting a vulnerability

**Do not open a public issue.**

Report privately through GitHub's **Private Vulnerability Reporting**:

> [github.com/thai-pc/fluxgantt/security/advisories/new](https://github.com/thai-pc/fluxgantt/security/advisories/new)

This is the only reporting channel — it keeps the report, the discussion and the eventual advisory
in one place, and it needs no third-party mailbox to be trusted.

Please include:

- affected package and version;
- a minimal reproduction — a task/dependency fixture, an import file, or a config, whichever
  triggers it;
- the impact you believe it has (XSS in a host page, data exfiltration, denial of service…);
- your assessment of severity, if you have one.

### What to expect

- **Acknowledgement** within 7 days.
- An assessment, and a fix timeline if the report is confirmed, within 30 days.
- Credit in the advisory and the changelog, unless you ask otherwise.

This is a volunteer-maintained MIT project: there is no bug bounty, and response times are
best-effort rather than contractual.

## What is in scope

FluxGantt is an embedded library that renders data supplied by the host application and by files a
user imports. That data is untrusted, and the interesting vulnerability classes follow from it:

- **XSS through rendering** — a `task.name`, `notes`, `meta` value or `task.color` that escapes
  into markup, a style, or an attribute. The renderers must use `textContent` /
  `createElementNS` + `setAttribute`, never `innerHTML` or string interpolation.
- **XSS through an export** — an exported SVG can be opened as HTML, so serialisation must
  sanitise.
- **Parser attacks on import** — JSON/CSV/MS Project XML. XXE and entity expansion (DTD and
  external entities must be disabled), unbounded task counts, hierarchy depth or string lengths,
  and dependency cycles that could loop forever in the critical-path pass.
- **CSV formula injection** in exported files opened by a spreadsheet.
- **CSP violations** — the library must run under a strict host CSP: no inline script, no `eval`,
  no `new Function`.
- **Prototype pollution** through imported or host-supplied objects.

The full threat model this project holds itself to is `.claude/rules/security.md`.

## What is out of scope

- Vulnerabilities in the host application's own code or in its handling of FluxGantt's output.
- Findings that require the host to pass deliberately malicious configuration it controls
  directly (e.g. a host injecting script into its own page through a FluxGantt callback).
- Denial of service achievable only by the host supplying an unbounded dataset in-process, with no
  file or network boundary crossed.
- Reports from automated scanners with no demonstrated impact.
- The example apps under `examples/` and the docs site under `apps/docs` — demonstrations, not
  shipped artefacts.
