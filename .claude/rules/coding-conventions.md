# Rule: Coding Conventions

## Method naming
Verb + noun, **camelCase**. Tránh prefix `set`/`get` generic (chỉ dùng cho property access đơn giản).
```ts
// ✓ Nên
gantt.addTask(task); gantt.linkTasks(from, to, 'FS'); gantt.computeCriticalPath();
gantt.exportPng(); gantt.zoomTo('week'); gantt.scrollToTask(id);
// ✗ Tránh
gantt.task_add(task);            // snake_case
gantt.createNewTaskInGantt(t);   // dài dòng
gantt.do('add', task);           // action generic
gantt.set('zoom', 'week');       // setter generic
```

## Event naming
Past tense, namespace bằng `:`, lowercase. Đọc như "điều gì đó đã xảy ra".
```
task:added  task:moved  task:resized  task:removed  task:progress
dependency:added  dependency:removed
resource:assigned  resource:unassigned
baseline:saved  selection:changed  viewport:changed
critical-path:computed  conflict:detected
```
`gantt.on(event, cb)` trả về `UnsubscribeFn`.

## Type naming
PascalCase. **Không prefix `I`**. Không suffix `Type` thừa.
```ts
type Task = { ... }           // ✓
type DependencyType = 'FS'|'SS'|'FF'|'SF'   // ✓ (suffix có nghĩa)
interface ITask { ... }       // ✗ prefix I lỗi thời
type TaskType = { ... }       // ✗ suffix thừa
type taskConfig = { ... }     // ✗ camelCase sai
```
Branded ID: `type TaskId = string & { readonly __brand: 'TaskId' }`.

## File & folder naming
| Loại | Convention | Ví dụ |
|---|---|---|
| Files | kebab-case | `task-store.ts`, `critical-path.ts` |
| Folders | kebab-case | `store/`, `compute/`, `render/` |
| Tests | `*.test.ts` | `task-store.test.ts` |
| Types | `types.ts` | mỗi package/feature folder |
| Index | `index.ts` | barrel export |
Component files (React/Vue/Svelte) dùng PascalCase: `FluxGantt.tsx`, `FluxGantt.vue`.

## CSS (BEM, prefix `fg-`)
Mọi class prefix `fg-` để không xung đột host app. Custom property prefix `--fg-*`.
```
.fg-timeline  .fg-timeline__header  .fg-timeline__row
.fg-task  .fg-task__bar  .fg-task__progress
.fg-task--critical  .fg-task--selected  .fg-task--milestone
.fg-dependency  .fg-dependency--fs  .fg-resource-panel
```

## TypeScript
- `strict: true`. Không `any` ngầm. Ưu tiên `unknown` + narrow.
- Strict null checks. Branded ID không ép kiểu tuỳ tiện — tạo qua factory/validator.
- ESM-first. Export qua barrel `index.ts`. Giữ public surface nhỏ, ổn định.
- Mọi thứ tree-shakable: tránh side-effect ở top-level module, đánh dấu `"sideEffects": false` trong package.json.

## NPM packages
`@fluxgantt/{core,react,vue,svelte,angular,ai,msproject,cloud-sdk,themes,icons,dev-tools}`. Wrapper chỉ depend core + framework tương ứng.

## Design tokens
Dùng CSS custom properties `--fg-*` (typography, density, spacing, theme light/dark, task/resource colors, grid, dependency, animation). Định nghĩa ở mục 8.2 spec. Màu chủ đạo indigo `#6366f1`; critical path red `#ef4444` **và** phân biệt không-cần-màu (viền dashed) cho a11y.

## Commit / release
Dùng **changesets** trước mỗi thay đổi public. Versioning + changelog tự động. Conventional, súc tích.
