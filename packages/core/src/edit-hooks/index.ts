// Host edit hooks barrel (spec-host-edit-hooks.md). The opt-in capability only; imports nothing
// from `render/` or `interaction/`. Tier Core.
export { withEditHooks } from './mixin.js';
export type { EditHooksOptions } from './mixin.js';
export type { TaskActivatedPayload, TaskContextRequestedPayload, TaskHitPart } from '../gantt.js';
