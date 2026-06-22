// Resolver cho Temporal API. Spec §4.1: Temporal là optional peerDependency —
// KHÔNG bundle vào core. Code đọc `globalThis.Temporal` (native nếu runtime có,
// hoặc do consumer cài @js-temporal/polyfill và gán vào global).
//
// `import(...)` bên dưới là TYPE-ONLY query → bị erase khi build, không kéo polyfill
// vào bundle (đã verify: core bundle ~18KB, không chứa code polyfill).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- type-only, cố ý để tránh bundle polyfill
export type TemporalApi = (typeof import('@js-temporal/polyfill'))['Temporal'];

export function getTemporal(): TemporalApi {
  const t = (globalThis as { Temporal?: TemporalApi }).Temporal;
  if (!t) {
    throw new Error(
      '@fluxgantt/core: Temporal API không khả dụng. Dùng runtime có Temporal native, ' +
        'hoặc cài @js-temporal/polyfill và gán `globalThis.Temporal` trước khi dùng calendar/CPM.',
    );
  }
  return t;
}
