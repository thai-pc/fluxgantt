---
'@fluxgantt/core': minor
---

Add host edit hooks. The opt-in `withEditHooks({ longPressMs? })` mixin on the new
`@fluxgantt/core/edit-hooks` subpath emits `task:activated` (double-click, Enter on a leaf row, F2)
and `task:context-requested` (right-click, ContextMenu key, Shift+F10, touch long-press), so the host
builds its own editor and menu. Payloads are `{ taskId, part, source, clientX, clientY }`; the
context event also carries `preventDefault()`, which suppresses the native menu only when called.
Both fire in `readOnly` charts, Enter on a summary row still collapses, and Canvas never reports
`part: 'bar'`. Also adds `GanttConfig.enableDependencyDrag` (default `true`): `false` renders no
link handles and wires no drag-create-dependency. New `TaskActivatedPayload`,
`TaskContextRequestedPayload` and `TaskHitPart` types. Purely additive: existing bundle sizes grow
by under 60 B (the flag) and the mixin is not part of any existing fixture.
