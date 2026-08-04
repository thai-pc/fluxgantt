// IO layer barrel — JSON/CSV export/import is pure-data (spec-io-json-csv.md §2.1); SVG/PNG
// export is DOM-dependent/browser-only (spec-export-png-svg.md §11 — see export-svg.ts's own
// header for the exemption). Tier Core.
export { exportJson, importJson } from './json.js';
export { exportCsv, importCsv, DEFAULT_CSV_COLUMNS, escapeCsvValue } from './csv.js';
export { exportSvg } from './export-svg.js';
export { exportPng } from './export-png.js';
export { IoValidationError } from './errors.js';
export { DEFAULT_IMPORT_LIMITS } from './limits.js';
export type {
  ExportBundle,
  ExportedTask,
  ExportedDependency,
  ExportedTaskConstraint,
  ExportJsonOptions,
  ExportCsvOptions,
  ExportSvgOptions,
  ExportPngOptions,
  ImportJsonOptions,
  ImportCsvOptions,
  ImportLimits,
  ImportResult,
  ImportCsvResult,
  CsvColumn,
} from './types.js';
