# Rule: Coding Conventions

## Method naming
Verb + noun, **camelCase**. Avoid generic `set`/`get` prefixes (only for simple property access).
```ts
// ✓ Do
gantt.addTask(task); gantt.linkTasks(from, to, 'FS'); gantt.computeCriticalPath();
gantt.exportPng(); gantt.zoomTo('week'); gantt.scrollToTask(id);
// ✗ Avoid
gantt.task_add(task);            // snake_case
gantt.createNewTaskInGantt(t);   // verbose
gantt.do('add', task);           // generic action
gantt.set('zoom', 'week');       // generic setter
```

## Event naming
Past tense, namespaced with `:`, lowercase. Reads as "something happened".
```
task:added  task:moved  task:resized  task:removed  task:progress
dependency:added  dependency:removed
resource:assigned  resource:unassigned
baseline:saved  selection:changed  viewport:changed
critical-path:computed  conflict:detected
```
`gantt.on(event, cb)` returns an `UnsubscribeFn`.

## Type naming
PascalCase. **No `I` prefix**. No redundant `Type` suffix.
```ts
type Task = { ... }           // ✓
type DependencyType = 'FS'|'SS'|'FF'|'SF'   // ✓ (meaningful suffix)
interface ITask { ... }       // ✗ dated I prefix
type TaskType = { ... }       // ✗ redundant suffix
type taskConfig = { ... }     // ✗ wrong camelCase
```
Branded ID: `type TaskId = string & { readonly __brand: 'TaskId' }`.

## File & folder naming
| Kind | Convention | Example |
|---|---|---|
| Files | kebab-case | `task-store.ts`, `critical-path.ts` |
| Folders | kebab-case | `store/`, `compute/`, `render/` |
| Tests | `*.test.ts` | `task-store.test.ts` |
| Types | `types.ts` | per package/feature folder |
| Index | `index.ts` | barrel export |
Component files (React/Vue/Svelte) use PascalCase: `FluxGantt.tsx`, `FluxGantt.vue`.

## CSS (BEM, `fg-` prefix)
Every class is `fg-`-prefixed to avoid clashing with the host app. Custom properties are `--fg-*`-prefixed.
```
.fg-timeline  .fg-timeline__header  .fg-timeline__row
.fg-task  .fg-task__bar  .fg-task__progress
.fg-task--critical  .fg-task--selected  .fg-task--milestone
.fg-dependency  .fg-dependency--fs  .fg-resource-panel
```

## TypeScript
- `strict: true`. No implicit `any`. Prefer `unknown` + narrow.
- Strict null checks. Don't cast branded IDs carelessly — create them via factory/validator.
- ESM-first. Export via the barrel `index.ts`. Keep the public surface small and stable.
- Everything tree-shakable: avoid top-level module side effects, mark `"sideEffects": false` in package.json.

## NPM packages
`@fluxgantt/{core,react,vue,svelte,angular,ai,msproject,cloud-sdk,themes,icons,dev-tools}`. A wrapper depends only on core + its framework.

## Design tokens
Use CSS custom properties `--fg-*` (typography, density, spacing, light/dark theme, task/resource colors, grid, dependency, animation). Defined in §8.2 of the spec. Primary color indigo `#6366f1`; critical path red `#ef4444` **and** a not-color-dependent distinction (dashed outline) for a11y.

## Commit / release
Use **changesets** before every public change. Automated versioning + changelog. Conventional, concise.
