---
description: Security-review the current change (or $ARGUMENTS) via the security-reviewer subagent — FluxGantt's XSS/parsing/AI/authZ checklist.
argument-hint: [what to review, e.g. "CSV importer" or a path; empty = current change]
---
Use the **security-reviewer** subagent to review $ARGUMENTS.

If $ARGUMENTS is empty, review the uncommitted change (`git status` / `git diff`).

Per `.claude/agents/security-reviewer.md` and the `.claude/rules/security.md` checklist, go in
risk order: render XSS (interpolating `task.name`/`notes`/`meta`/`color` into SVG/DOM;
whitelist color; sanitize export), untrusted parsing (schema validation, XXE for XML, DoS
size/depth, CSV formula injection, cycle throw), AI/prompt-injection, Cloud authZ (scope by
tenant + role server-side, share-token entropy + hash, API-key hash, SQL params, webhook
HMAC/SSRF, rate limit), secrets/dependencies.

Each finding: severity + `file:line` + why it's dangerous + how to fix. Distinguish real
vulnerabilities from hardening; if it's safe, say so. Write numbered findings to
`.claude/work/review-<slug>.md`. Review only, do not fix.
