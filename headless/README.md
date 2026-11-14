# FluxGantt headless example

`@fluxgantt/core` computes the schedule with no DOM at all: no renderer, no framework, no
`window`. This project runs the critical-path engine in plain Node.

```bash
npm install
npm start
```

`index.mjs` is the whole example. Change the tasks or dependencies and run it again.

Core reads `globalThis.Temporal` and bundles no polyfill. Node 22 and 24 have no native Temporal,
so this example installs `@js-temporal/polyfill` and assigns it only when the runtime lacks it.

Docs: https://github.com/thai-pc/fluxgantt
