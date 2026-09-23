// Responsive/touch layer barrel (spec-responsive-mobile.md). The opt-in facade capability only;
// this module deliberately imports nothing from `render/` or `interaction/`, so it can never pull
// either into a consumer's graph. Tier Core.
export { withResponsive } from './mixin.js';
export type { ResponsiveCapability, ResponsiveOptions } from './mixin.js';
