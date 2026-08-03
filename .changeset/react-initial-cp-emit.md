---
"@fluxgantt/react": patch
---

fix(react): deliver the initial `critical-path:computed` to `onCriticalPathComputed`

The mount effect called `instance.mount()` before subscribing the event bridges, but `mount()`
runs the renderer's reactive effect synchronously and emits the initial `critical-path:computed`
for any initial tasks — so that first event was missed. Subscriptions now happen before
`mount()` (`on()` works headless), so `onCriticalPathComputed` receives the initial computation.
