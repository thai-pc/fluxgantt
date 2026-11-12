// The one pattern for the `export const VERSION = '…'` line in a package's `src/index.ts`.
// Shared by sync-version-constant.mjs (rewrites it) and check-publish-readiness.mjs (verifies it)
// so the two cannot drift apart again: the optional `: string` annotation is what keeps the API
// report from churning on every release. Groups: 1 = prefix, 2 = version, 3 = closing quote.
export const VERSION_PATTERN = /(export const VERSION(?:: string)? = ')([^']*)(')/;
