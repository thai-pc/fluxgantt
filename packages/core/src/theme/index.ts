// Theme layer barrel (spec §7.6 / §8.2). Pure token data + the opt-in facade capability; this
// module deliberately imports nothing from `render/`, so it can never pull the renderer into a
// consumer's graph. Tier Core.
export { withTheme } from './mixin.js';
export type { ThemeCapability } from './mixin.js';
export { DARK_TOKENS } from './tokens.js';
export type { ThemeName, ResolvedTheme } from './tokens.js';
