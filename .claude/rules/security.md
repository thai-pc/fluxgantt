# Rule: Security (MUST read before touching IO / Auth / Cloud / AI)

FluxGantt renders data **provided by others** (host-app tasks, file imports, share links). Every external input is **untrusted**.

## 1. Rendering & XSS (Core — most important, since it's an embedded library)
- **SVG renderer**: NEVER interpolate user strings into markup. Use `textContent` / `createElementNS` + `setAttribute`, not `innerHTML`/template strings for `task.name`, `notes`, `meta`, `color`.
- `task.color` and any value that flows into style/attribute must be **whitelist-validated** (valid hex/CSS color), disallowing `url(...)`, `expression`, `javascript:`.
- Export SVG/PNG/PDF: sanitize before serializing — exported SVG can be opened as HTML.
- `meta: Record<string, unknown>` is a free-form user field → treat as untrusted when displayed.
- Respect the host app's CSP: no inline script, no `eval`, no `new Function`.

## 2. Import / Parsing (IO layer)
- **JSON/CSV/MS Project XML** = untrusted. Validate the schema before loading into the store (e.g. zod or a hand-written validator). Reject rather than "best-effort" on bad data.
- **XML (MS Project)**: the parser must **disable external entities / DTD** → prevents XXE. Don't resolve external entities, no network fetch while parsing. Limit size & depth (guards against billion-laughs / entity-expansion DoS).
- CSV: guard against **formula injection** — escape cells starting with `= + - @ tab/CR` when exporting to a file opened in Excel.
- Limits: task count, hierarchy depth, string length → avoid DoS via a malicious file.
- Dependency cycles must be detected and thrown, no infinite loop (CPM).

## 3. AI layer (Pro/Cloud) — prompt injection
- User natural-language input going into the LLM = **untrusted**. Don't concatenate it straight into the system prompt; separate system vs user content clearly.
- LLM output (task/dep JSON) must be **re-validated against a schema** before use — don't trust the returned structure.
- AI **"suggests", doesn't "decide"**: always let the user review + revert. Don't overwrite the plan automatically.
- Don't send sensitive project data to the LLM without consent / per tier. Log/redact PII.

## 4. Cloud backend (Wave 3)
- **Multi-tenant authZ**: scope every query by `org_id` / `project_id`. Check `membership.role` (owner/admin/editor/viewer) on the **server**, don't trust the client. IDOR is risk #1.
- **Auth**: Better-Auth. Don't log passwords/secrets. Session cookie `HttpOnly`, `Secure`, `SameSite`.
- **Share link**: `token` random ≥ 32 bytes of entropy (stored unique). `password_hash` uses **argon2/bcrypt** (the `password_hash` column in the schema — never store plaintext). Respect `expires_at`, `permission` (read/comment/edit), increment `view_count` safely.
- **API keys**: store only `key_hash` (a hash, not plaintext) + `prefix` for identification. Support `scopes` + `revoked_at`. Show the full key exactly once at creation.
- **SQL**: use parameterized Drizzle, no string-concatenated queries. JSONB (`meta`, `settings`, `snapshot`) still validated before storing.
- **Webhooks**: sign the payload (HMAC), verify the signature on the receiving side. Guard against SSRF when calling a user-provided URL (block internal IPs, the metadata endpoint).
- **Rate limiting** on API + AI endpoints (per-call cost). Hard limits per tier.
- **Multiplayer (Yjs)**: authZ before joining a room; don't trust CRDT updates from an unauthenticated client.

## 5. Secret & dependency management
- Don't hardcode secrets (Stripe, Resend, DB URL, R2, LLM key). Use env, don't commit `.env`.
- Stripe webhook: verify the signature. Don't trust price/tier from the client.
- Minimize dependencies (also keeps the bundle small). Audit regularly (`pnpm audit`), pin versions, use a lockfile.
- License key (Pro): validate the signature, don't let the client bypass it; but don't "phone home" in a privacy-invasive way.

## 6. Privacy (GDPR — Cloud/Enterprise)
- Privacy-by-design. Allow exporting & deleting user data. Data-residency option for Enterprise. DPA template ready.
- Analytics via Plausible (privacy-first), don't track unnecessary PII.

## Quick checklist when writing code that touches external input
- [ ] Is the input schema-validated?
- [ ] Any user string interpolated into DOM/SVG/SQL/prompt? → fix it.
- [ ] Are XML external entities disabled?
- [ ] Are queries scoped by tenant + role-checked?
- [ ] Could a secret leak into logs/commits/client?
- [ ] Are there size/depth/rate limits to prevent DoS?
