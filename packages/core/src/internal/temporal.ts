// Resolver for the Temporal API. Spec §4.1: Temporal is an optional peerDependency —
// NOT bundled into core. Code reads `globalThis.Temporal` (native when the runtime
// provides it, or set by the consumer after installing @js-temporal/polyfill).
//
// The `import(...)` below is a TYPE-ONLY query → erased at build time, so it never pulls
// the polyfill into the bundle (verified: core bundle ~18KB, contains no polyfill code).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- type-only, intentional to avoid bundling the polyfill
export type TemporalApi = (typeof import('@js-temporal/polyfill'))['Temporal'];

export function getTemporal(): TemporalApi {
  const t = (globalThis as { Temporal?: TemporalApi }).Temporal;
  if (!t) {
    throw new Error(
      '@fluxgantt/core: Temporal API is not available. Use a runtime with native Temporal, ' +
        'or install @js-temporal/polyfill and set `globalThis.Temporal` before using calendar/CPM.',
    );
  }
  return t;
}
