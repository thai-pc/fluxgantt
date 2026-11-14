// Grid cell editors barrel (spec-grid-columns.md section 2.2). The opt-in capability only: the editor code is a
// lazy chunk (`editing-ui`), fetched when a cell is first edited. Imports nothing from `interaction/`. Tier Core.
// `@beta`.
export { withGridEditing } from './mixin.js';
export type { CellEditCommit, GridEditingCapability, GridEditingOptions } from './types.js';
export type { CellEditor } from '../grid/types.js';
export type { CellEditRequestedPayload } from '../gantt.js';
export type { EditErrorReason } from '../types.js';
