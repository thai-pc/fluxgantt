// Post-facade-split test helper (spec-facade-split.md §3.2/§3.3).
//
// `createGantt()` itself is now the BASE facade only — IO (`exportJson`/`importCsv`/...),
// rendering (`mount`/`unmount`/`refresh`) and interaction (drag/keyboard/click wiring) are
// opt-in mixins living on their own subpath entries. Most of this suite predates the split and
// exercises the fully-composed instance, so rather than repeat the composition at every call
// site, these files import `createGantt` from here instead.
//
// A test that specifically asserts what the BASE instance does or does not carry must import
// `createGantt` from `../../src/gantt.js` directly instead.
import { createGantt as createGanttBase } from '../../src/gantt.js';
import type { GanttConfig, GanttInstance } from '../../src/gantt.js';
import { withIo, type IoCapability } from '../../src/io/mixin.js';
import { withRender, type RenderCapability } from '../../src/render/mixin.js';
import { withInteraction } from '../../src/interaction/mixin.js';

/** Every capability composed — structurally identical to the pre-split `createGantt()`. */
export function createGantt(config: GanttConfig): GanttInstance & IoCapability & RenderCapability {
  return withInteraction(withIo(withRender(createGanttBase(config))));
}
