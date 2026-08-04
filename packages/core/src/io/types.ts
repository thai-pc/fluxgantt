// IO-local types (spec-io-json-csv.md §1.3) — serialization concerns, one layer removed
// from the domain model in `../types.ts`. No runtime code in this file (types only), matching
// the existing precedent of `render/`'s and `compute/`'s own local `*Options`/`*Result`
// types living beside their functions rather than in the shared domain `types.ts` barrel.
import type { TaskInput } from '../store/index.js';
import type { Dependency, DependencyType, ResourceAssignment, TaskKind } from '../types.js';

// --- JSON envelope (export shape) -------------------------------------------------------

export type ExportedTaskConstraint =
  | { kind: 'asap' }
  | { kind: 'alap' }
  | {
      kind:
        | 'must-start-on'
        | 'must-finish-on'
        | 'start-no-earlier-than'
        | 'start-no-later-than'
        | 'finish-no-earlier-than'
        | 'finish-no-later-than';
      date: string; // ISO-8601 UTC instant, e.g. "2026-01-15T17:00:00Z"
    };

export interface ExportedTask {
  id: string;
  name: string;
  start: string; // ISO-8601 UTC instant
  end: string; // ISO-8601 UTC instant
  duration?: number;
  progress: number;
  priority?: number;
  parent?: string;
  type: TaskKind;
  constraint?: ExportedTaskConstraint;
  /** Pass-through verbatim (already JSON-safe — no `DateInput` inside). Pro-tier per-task
   *  field; Core doesn't populate it but round-trips it if present. */
  resources?: ResourceAssignment[];
  notes?: string;
  color?: string;
  meta?: Record<string, unknown>;
  createdAt: string; // ISO-8601 UTC instant — informational, dropped on re-import (see §9/§10)
  updatedAt: string;
}

export interface ExportedDependency {
  id: string;
  from: string;
  to: string;
  type: DependencyType;
  lag?: number;
}

export interface ExportBundle {
  fluxgantt: {
    schemaVersion: '1.0';
    /** ISO-8601 UTC instant at which `exportJson` was called. */
    exported_at: string;
  };
  tasks: ExportedTask[];
  dependencies: ExportedDependency[];
}

// --- Options -------------------------------------------------------------------------------

export interface ExportJsonOptions {
  /** IANA timezone used only to disambiguate a bare wall-clock `DateInput` (a string with no
   *  offset/`Z`, or a `Temporal.PlainDate`) — has no effect on inputs that already carry an
   *  unambiguous instant. Default `'UTC'`. */
  timezone?: string;
}

export interface ExportCsvOptions {
  /** Same disambiguation-only semantics as `ExportJsonOptions.timezone`. Default `'UTC'`. */
  timezone?: string;
  /** Ordered subset of `DEFAULT_CSV_COLUMNS` selecting which columns to emit and in what
   *  order. Passing a name outside the known 10 throws synchronously (programmer error, not
   *  untrusted input). Default: `DEFAULT_CSV_COLUMNS` (all columns, canonical order). */
  columns?: readonly CsvColumn[];
}

// --- SVG/PNG export (spec-export-png-svg.md §2) -------------------------------------------

export interface ExportSvgOptions {
  /**
   * Bakes each element's browser-RESOLVED `fill`/`stroke`/`stroke-width`/`stroke-dasharray`/
   * `text-anchor`/`dominant-baseline` value (read via `getComputedStyle` on the LIVE mounted
   * node) into the exported copy's inline `style`, so the returned string matches the host's
   * actual rendered theme — including any host override of `--fg-*` custom properties —
   * rather than only the hardcoded `var(--fg-token, fallback)` defaults. WYSIWYG. Default
   * `true`.
   *
   * Set `false` only to get a smaller, theme-RELATIVE SVG that still carries the original
   * `var(--fg-token, fallback)` declarations verbatim (e.g. to re-skin the exported file later
   * by wrapping it in a stylesheet that redefines those custom properties) — accepting that it
   * will NOT visually match the live page when opened standalone.
   */
  readonly inlineComputedStyle?: boolean;
}

export interface ExportPngOptions {
  /**
   * Raster scale multiplier — output pixel size = SVG width/height × `scale`. Pass
   * `window.devicePixelRatio` from the host for crisp HiDPI output; this module never reads
   * `window.devicePixelRatio` itself (deterministic default). Must be a finite number > 0.
   * Default `1`.
   */
  readonly scale?: number;
  /**
   * Fill painted under the rasterized chart before drawing (the source SVG has no background
   * rect, so a naive rasterization is transparent). A CSS color string — the `Task.color`
   * whitelist (hex/rgb()/hsl()) OR a bare CSS keyword (`'white'`/`'black'`/…) — or the literal
   * `'transparent'` to skip the fill. Default `'#ffffff'`.
   */
  readonly background?: string | 'transparent';
  // NOTE: no `inlineComputedStyle` — PNG rasterizes via an `<img>` in an isolated document with
  // no access to the host's `--fg-*` custom properties, so styles MUST be baked; exposing the
  // option would only let a caller silently mis-theme the raster (review B4).
}

export interface ImportLimits {
  maxTaskCount: number;
  maxDependencyCount: number;
  maxIdLength: number;
  maxNameLength: number;
  maxStringLength: number;
  maxMetaKeys: number;
  maxMetaDepth: number;
  maxHierarchyDepth: number;
  /** Pre-parse gate on the raw string form of `input`/`csv` (`.length`, UTF-16 code units).
   *  Only applies when the input is a string. */
  maxInputLengthChars: number;
}

export interface ImportJsonOptions {
  /** Overrides individual caps; merged shallowly over `DEFAULT_IMPORT_LIMITS`. */
  limits?: Partial<ImportLimits>;
}

export interface ImportCsvOptions {
  limits?: Partial<ImportLimits>;
}

// --- Results ---------------------------------------------------------------------------------

/** Mirrors `GanttConfig.dependencies`' own `DependencyInput` shape (`Omit<Dependency, 'id'>`)
 *  structurally — defined locally rather than imported from `gantt.ts` to avoid a circular
 *  import (`gantt.ts` imports `io/index.js`, not the other way around). */
export type DependencyInput = Omit<Dependency, 'id'>;

export interface ImportResult {
  tasks: TaskInput[];
  dependencies: DependencyInput[];
}

export interface ImportCsvResult {
  tasks: TaskInput[];
}

// --- CSV ---------------------------------------------------------------------------------

export type CsvColumn =
  | 'id'
  | 'name'
  | 'start'
  | 'end'
  | 'duration'
  | 'progress'
  | 'type'
  | 'parent'
  | 'notes'
  | 'color';
