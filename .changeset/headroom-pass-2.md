---
'@fluxgantt/core': patch
---

Recover bundle headroom: the internal `GanttInternal` / `MountState` / pointer-drag member names are shorter (property names survive minification and repeat across every mixin), undo and redo share one `applyOp`, the CPM and cascade passes share one `indexGraph`, the pointer-drag coordinator owns the drag chrome (class + cursor) the three recognizers each used to repeat, CSV and JSON import share their optional-field and array-limit helpers, and four explanatory diagnostic tails nothing asserts on are shorter (duplicate task id in `createGantt`/imports, the `computeGridColumns` guard, the working-calendar iteration guard, a CPM internal error). The retained phrases are `duplicate task id`, `exceeded max column guard`, `exceeded max iteration guard`. No public API or behavior change; exported SVG output is byte-identical.
