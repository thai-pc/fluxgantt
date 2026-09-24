---
'@fluxgantt/core': patch
'@fluxgantt/react': patch
'@fluxgantt/vue': patch
---

Ship a real `LICENSE` in each package tarball, and document why the published `.d.ts` files import
the `Temporal` type from `@js-temporal/polyfill`.

pnpm already injected the workspace-root LICENSE at pack time, so this changes nothing for anyone
installing from a pnpm-built tarball. It matters because the license text no longer depends on
which packer ran: `files` now lists `LICENSE` explicitly, and the file is a real copy in each
package (`npm pack` does not follow symlinks).

The Temporal note is documentation only — no code moved. `@js-temporal/polyfill` stays an optional
peer, correctly: core bundles none of it and resolves `globalThis.Temporal` at runtime. But the
type import in the shipped declarations means a TypeScript consumer compiling with
`skipLibCheck: false` needs the package installed even on a native-Temporal runtime. Both ways out
were measured and are worse — `temporal-spec`'s `Duration.round` overloads make real polyfill
instances non-assignable (`TS2345` at the consumer's call site), and TypeScript's built-in
`lib.esnext.temporal` does not exist before TypeScript 6 — so the README and the installation page
now say plainly what to install and why.
