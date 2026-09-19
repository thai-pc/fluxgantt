// Opt-in IO capability mixin (spec-facade-split.md §3.2).
//
// WHY THIS IS A MIXIN, NOT A CLASS METHOD SET: class prototype methods can never be
// tree-shaken, so every `exportJson`/`importCsv`/`exportPng` body that lived on the `Gantt`
// class was billed to the hello-world bundle even for consumers who never touched IO. Moving
// them into free functions behind `withIo()` makes the entire `io/*` graph opt-in.
//
// Method signatures and contracts are UNCHANGED from the pre-split `GanttInstance` — only the
// way you obtain them changed:
//
//   import { createGantt } from '@fluxgantt/core';
//   import { withIo } from '@fluxgantt/core/io';
//   const gantt = withIo(createGantt({ tasks, dependencies }));
//   gantt.exportJson();
//
// `exportSvg`/`exportPng` additionally need a live SVG mount, which only `withRender` provides
// — they read the SHARED mount slot on `GanttInternal`, so it does not matter whether this
// mixin or another one was applied first (composition order is irrelevant, §2.2).
import type { GanttInstance, ImportSummary } from '../gantt.js';
import { getInternal } from '../gantt-internal.js';
import {
  exportCsv as exportCsvFn,
  exportJson as exportJsonFn,
  exportPng as exportPngFn,
  exportSvg as exportSvgFn,
  importCsv as importCsvFn,
  importJson as importJsonFn,
} from './index.js';
import type {
  ExportBundle,
  ExportCsvOptions,
  ExportJsonOptions,
  ExportPngOptions,
  ExportSvgOptions,
  ImportCsvOptions,
  ImportJsonOptions,
} from './index.js';

/** The methods `withIo()` adds to a `GanttInstance`. */
export interface IoCapability {
  /** Thin delegation over `getTasks()`/`getDependencies()` + the pure `exportJson()`
   *  function — same post-`destroy()` posture as those two getters (returns an
   *  empty-but-valid bundle rather than throwing; see spec-io-json-csv.md §1.2). Defaults
   *  `options.timezone` to the instance's own calendar timezone, not `'UTC'`. */
  exportJson(options?: ExportJsonOptions): ExportBundle;
  /** Thin delegation over `getTasks()` + the pure `exportCsv()` function. Same posture as
   *  `exportJson()` above. */
  exportCsv(options?: ExportCsvOptions): string;

  /**
   * Validates `data` via the pure `importJson()` function, then wholesale-REPLACES the
   * entire live task/dependency set — equivalent to what `createGantt({ tasks, dependencies })`
   * would have produced from the same data (NOT a merge/append). Concretely, on success:
   *  1. Clears BOTH the undo and redo stacks — prior entries reference a pre-import state
   *     that may no longer exist post-replace. The import itself is NOT recorded as an
   *     undoable op — same precedent as construction-time `config.tasks`/`config.dependencies`
   *     seeding.
   *  2. Clears the current selection, equivalent to `deselect()`.
   *  3. Emits exactly ONE `data:imported` event — never per-item `task:added`/
   *     `dependency:added`.
   *  4. Triggers exactly one repaint of a mounted chart (batched), via the same
   *     store-`revision`-driven reactive effect every other mutation uses.
   *
   * NOT gated by `readOnly` (matches every other programmatic mutation method).
   *
   * ATOMIC against the live instance: the complete replacement dataset is validated and
   * staged BEFORE any live store is touched. A rejected import — an invalid schema (rejected
   * by the pure `importJson()` itself) OR a cyclic dependency set (which the pure
   * `importJson()` deliberately does NOT detect — see `io/json.ts`'s own note — and only
   * surfaces when the staged data is linked) — leaves the live instance's tasks,
   * dependencies, undo/redo history, and selection completely UNCHANGED, and does not fire
   * `data:imported`.
   *
   * Throws if the instance is destroyed (same posture as every other mutating method).
   *
   * `options` is passed straight through to the pure `importJson()` — no facade-level
   * default injected (unlike `exportJson`'s `timezone` default: `ImportJsonOptions` has no
   * `timezone` field to default, only `limits`).
   */
  importJson(data: string | object, options?: ImportJsonOptions): ImportSummary;

  /**
   * Same contract as `importJson()` above, for CSV. CSV has no dependency concept
   * (`io/csv.ts`'s own header comment: "Tasks-only, flat scalar columns... dependencies are
   * NOT representable in CSV at all") — `dependencyCount` is always `0` in the returned/
   * emitted summary, and any dependency the live instance held before the call is cleared
   * along with the task set (wholesale replace is dataset-wide, not tasks-only — importing a
   * tasks-only CSV still wipes pre-existing dependencies, matching what
   * `createGantt({ tasks })` with no `dependencies` key would produce).
   */
  importCsv(csv: string, options?: ImportCsvOptions): ImportSummary;

  /**
   * Serializes the currently-mounted SVG to a self-contained string (XML declaration,
   * explicit xmlns, resolved computed styles baked in, no interactive-only chrome).
   * Throws if the instance was never mounted, or has been unmounted/destroyed — unlike
   * exportJson/exportCsv, there is no sensible empty-but-valid result to fall back to.
   * Requires `withRender()` to have been applied (nothing can be mounted otherwise).
   */
  exportSvg(options?: ExportSvgOptions): string;

  /**
   * Rasterizes the currently-mounted chart to a PNG. Internally calls exportSvg() to get a
   * baked/sanitized SVG string, then draws it onto a canvas. Async because it waits for the
   * browser to decode the SVG image before it can rasterize. Same throw-if-not-mounted
   * posture as exportSvg(), but delivered as a REJECTED promise, not a synchronous throw
   * (implemented as an `async function` specifically so this holds for every validation
   * error, not just the DOM-not-ready one).
   */
  exportPng(options?: ExportPngOptions): Promise<Blob>;
}

/**
 * Adds JSON/CSV/SVG/PNG import+export to a `createGantt()` instance.
 *
 * Mutates and returns the SAME object (`Object.assign`), so any reference already held by the
 * caller gains the methods too; the explicit `T & IoCapability` return type is what makes
 * composition order irrelevant — intersection types are commutative, so `withIo(withRender(g))`
 * and `withRender(withIo(g))` have the identical type.
 */
export function withIo<T extends GanttInstance>(instance: T): T & IoCapability {
  const internal = getInternal(instance);

  const io: IoCapability = {
    exportJson(options?: ExportJsonOptions): ExportBundle {
      // No assertAlive here — deliberately mirrors getTasks()/getDependencies()'s own
      // post-destroy() posture (returns an empty-but-valid result rather than throwing), since
      // this is a thin read-only delegation over exactly those two getters (spec §1.2).
      return exportJsonFn(instance.getTasks(), instance.getDependencies(), {
        timezone: internal.calendar.timezone,
        ...options,
      });
    },

    exportCsv(options?: ExportCsvOptions): string {
      return exportCsvFn(instance.getTasks(), {
        timezone: internal.calendar.timezone,
        ...options,
      });
    },

    importJson(data: string | object, options?: ImportJsonOptions): ImportSummary {
      internal.assertAlive('importJson');
      const { tasks, dependencies } = importJsonFn(data, options); // may throw IoValidationError
      return internal.commitImport(tasks, dependencies, 'json');
    },

    importCsv(csv: string, options?: ImportCsvOptions): ImportSummary {
      internal.assertAlive('importCsv');
      const { tasks } = importCsvFn(csv, options); // may throw IoValidationError
      return internal.commitImport(tasks, [], 'csv');
    },

    exportSvg(options?: ExportSvgOptions): string {
      const handle = internal.assertMountedSvg('exportSvg');
      return exportSvgFn(handle.svg, options);
    },

    async exportPng(options?: ExportPngOptions): Promise<Blob> {
      const handle = internal.assertMountedSvg('exportPng');
      return exportPngFn(handle.svg, options);
    },
  };

  return Object.assign(instance, io);
}
