---
'@fluxgantt/core': minor
---

Draw summary bars at their rolled-up span via the new `GanttConfig.rollup` provider.

Pass an aggregation to `createGantt` and every task that has children is painted from its
earliest descendant start to its latest descendant end, with duration-weighted aggregate
progress announced in its `aria-label`. The core implementation satisfies the contract as
written:

```ts
import { createGantt, computeRollup } from '@fluxgantt/core';
import { withRender } from '@fluxgantt/core/render';

const gantt = withRender(createGantt({ tasks, rollup: computeRollup }));
```

It is a function rather than a boolean flag on purpose: importing `computeRollup` into the
render layer would cost ~400 B gzip in every `@fluxgantt/core/render` bundle, including those
that never enable rollup. Injecting keeps those bytes in the graph of the host that asked for
them, and makes a custom aggregation (different weighting, a baseline span) a supported case.

Rollup is derived on read and never written back: `getTasks()`, `exportJson()`, undo/redo and
`computeCriticalPath()` all keep reporting the authored dates. The one behavioral consequence
beyond pixels is that a bar drawn at a rolled-up span is not drag-movable or drag-resizable —
the geometry under the cursor is not an authored value there is any well-defined way to
commit. Omitting `rollup` (the default) leaves rendering byte-identical to before.

Also exported: `RollupProvider`, `RolledUpRow` and `RolledUpSpan` types.
