---
'@fluxgantt/core': minor
---

Add light/dark theme switching via a new opt-in `withTheme()` mixin on `@fluxgantt/core/theme`.

```ts
import { withTheme } from '@fluxgantt/core/theme';

const gantt = withTheme(withRender(createGantt({ tasks, dependencies })));
gantt.mount(el);
gantt.setTheme('dark'); // 'light' | 'dark' | 'auto' (default, follows prefers-color-scheme live)
```

`withTheme` sets the dark palette as inline `--fg-*` custom properties on the mount container and
removes them again for light, so both renderers and `exportSvg()` follow with no renderer change.
Also adds `getTheme()` / `getResolvedTheme()`, and `GanttConfig.theme` to seed the initial value.

Theming ships as a mixin rather than `gantt.setTheme()` on the facade so that consumers who never
switch themes pay nothing for it: every existing bundle fixture is unchanged.
