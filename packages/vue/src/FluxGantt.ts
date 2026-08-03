// `<FluxGantt>` — the primary Vue API (resolution: component wraps the composable, same
// layering as react). Written as `defineComponent` + a render function in a plain `.ts` file
// — deliberately NOT a `.vue` SFC (resolution #4). Consumers still use it from an ordinary SFC
// template (`<FluxGantt :tasks="tasks" @task-moved="onMoved" />`) — only OUR source avoids the
// SFC compiler; nothing about this changes how a consumer writes their own template.
import { defineComponent, h, onBeforeUnmount, type PropType } from 'vue';
import { useFluxGantt } from './use-flux-gantt.js';
import type { DateInput, Dependency, DependencyId, GanttInstance, Task, TaskId } from '@fluxgantt/core';
import type {
  DependencyInput,
  Density,
  TaskInput,
  UseFluxGanttConfig,
  ViewMode,
  WorkingCalendar,
} from './types.js';

/**
 * Deviation from spec-vue-wrapper.md §4's literal `expose(instance)`, discovered while
 * implementing — NOT a reopening of resolution #2 ("expose the FULL `GanttInstance`, no
 * curated subset"): every method is still exposed, none omitted.
 *
 * Vue's `expose()` — and everything built on it, a parent's template ref (`ganttRef.value`)
 * AND `@vue/test-utils`'s `wrapper.vm` alike — hands the caller a `Proxy` wrapping whatever
 * object was passed to `expose()` (`instance.exposeProxy` internally). Calling a method
 * through that proxy, e.g. `ganttRef.value.addTask(...)`, binds `this` to the PROXY at the
 * call site (standard `a.b()` semantics: `this` is the object the property lookup started
 * from), not to the real `Gantt` object the proxy forwards reads to. `Gantt`'s methods
 * (`packages/core/src/gantt.ts`) use ES `#private` fields/methods, and private-element
 * access performs a brand check directly on `this` — a `Proxy` exotic object has no
 * `[[PrivateElements]]` internal slot of its own, so `this.#taskStore`/`this.#assertAlive(...)`
 * inside e.g. `addTask` throws `TypeError: Cannot read private member ... from an object
 * whose class did not declare it` the instant it's invoked through the exposed proxy.
 * Confirmed empirically (a minimal `class Foo { #x; getX() { return this.#x; } }` mounted
 * through the identical `defineComponent`/`expose()`/`@vue/test-utils` path reproduces the
 * exact same throw) — this is a genuine interaction between Vue's `expose()` design and
 * `core`'s private-field-based class, not a hypothetical.
 *
 * Fix: expose a plain object of PRE-BOUND methods instead of the raw instance. Each bound
 * function permanently fixes its own `this` to the real `Gantt` object via
 * `Function.prototype.bind`, so it behaves correctly no matter what object it's later
 * invoked through. Built by walking the instance's own prototype chain (not a hand-written
 * method-name list) so this can never drift from whatever methods `GanttInstance` actually
 * declares — the exact drift risk resolution #2 itself was written to avoid.
 */
function exposableInstance(instance: GanttInstance): GanttInstance {
  const bound: Record<string, unknown> = {};
  const seen = new Set<string>();
  let proto: object | null = Object.getPrototypeOf(instance);
  while (proto && proto !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key === 'constructor' || seen.has(key)) continue;
      seen.add(key);
      const value = (instance as unknown as Record<string, unknown>)[key];
      if (typeof value === 'function') {
        bound[key] = value.bind(instance);
      }
    }
    proto = Object.getPrototypeOf(proto);
  }
  return bound as unknown as GanttInstance;
}

/**
 * Note on construction-only props: `viewMode`/`density`/`locale`/`readOnly`/`calendar` are
 * read only once, when the underlying `GanttInstance` is created (`GanttInstance` has no
 * `setViewMode`/`setDensity`/`setLocale`/`setReadOnly`/`setCalendar` — same facade gap react
 * documented). Changing these props after mount is a no-op. A consumer who needs a
 * prop-driven `viewMode` change can force a full remount via Vue's `:key`
 * (`<FluxGantt :key="viewMode" :view-mode="viewMode" ... />`) — Vue tears down the old
 * component instance (and its `GanttInstance`) and mounts a fresh one, the same mechanism
 * react's `key`-remount workaround uses.
 *
 * Note on `class`/`style`: intentionally absent from `props` below — see `types.ts`'s
 * `FluxGanttProps` doc-comment. Vue's default attribute fallthrough handles them.
 *
 * Note on client-only usage (resolution #6): this component mounts into a real DOM node via
 * `GanttInstance.mount()` — it does not render anything meaningful during SSR. Under Nuxt,
 * wrap it in `<ClientOnly>`; nothing is shipped here to special-case a server context.
 */
export const FluxGantt = defineComponent({
  name: 'FluxGantt',
  props: {
    tasks: { type: Array as PropType<readonly TaskInput[]>, required: false },
    dependencies: { type: Array as PropType<readonly DependencyInput[]>, required: false },
    calendar: { type: Object as PropType<WorkingCalendar>, required: false },
    viewMode: { type: String as PropType<ViewMode>, required: false },
    density: { type: String as PropType<Density>, required: false },
    locale: { type: String, required: false },
    // `default: undefined` overrides Vue's Boolean-prop special case (an absent Boolean prop
    // WITHOUT an explicit default resolves to `false`, not `undefined`) — preserves the
    // facade's real tri-state ("unset" lets `GanttConfig`'s own default apply, distinct from
    // an explicit `false`).
    readOnly: { type: Boolean, required: false, default: undefined },
    onTaskChange: {
      type: Function as PropType<(task: Task, prev: Task) => void>,
      required: false,
    },
  },
  emits: {
    // Vue's object-form `emits` both registers the 8 events at runtime (so `v-on`/`@x`
    // listeners on unknown events still fall through as attrs correctly, and Vue's dev-mode
    // "unknown event" warning doesn't fire) AND drives TypeScript's inference of `emit`'s
    // signature inside `setup()` — the non-macro equivalent of `defineEmits<FluxGanttEmits>()`.
    // Validators always return `true` (no runtime payload re-validation here — the payload
    // already came from `@fluxgantt/core`'s own typed `GanttEventMap`, not external/untrusted
    // input); their PARAMETER TYPES, not their return value, are what TypeScript uses for
    // inference. Must be kept in sync with `FluxGanttEmits` in types.ts BY HAND — see §9
    // (guarded by the mandatory drift-guard test, tests/flux-gantt.test.ts).
    'task-added': (_task: Task) => true,
    'task-moved': (_task: Task, _prevStart: DateInput) => true,
    'task-resized': (_task: Task, _prevDuration: number) => true,
    'task-progressed': (_task: Task, _prevProgress: number) => true,
    'task-removed': (_taskId: TaskId) => true,
    'dependency-added': (_dependency: Dependency) => true,
    'dependency-removed': (_dependencyId: DependencyId) => true,
    'critical-path-computed': (_criticalTaskIds: readonly TaskId[]) => true,
  },
  setup(props, { emit, expose }) {
    // `props` (Vue's reactive props proxy) is passed straight through as `UseFluxGanttConfig`
    // — NOT destructured/spread first, so `useFluxGantt`'s internal `config.onTaskChange?.()`
    // read always observes the current prop value (see use-flux-gantt.ts's module
    // doc-comment).
    const { containerRef, instance } = useFluxGantt(props as UseFluxGanttConfig);

    // Bridge the 8 GanttEventMap events to this component's typed `emit`. Subscribe
    // SYNCHRONOUSLY in setup() — NOT in onMounted — so the listeners are active before
    // useFluxGantt's onMounted runs `instance.mount()`, which synchronously emits the INITIAL
    // `critical-path:computed` for any initial tasks. Subscribing in onMounted (which fires
    // AFTER the composable's mount onMounted) would miss that first emit. `on()` works headless
    // (pre-mount), so subscribing during setup is safe. Split from useFluxGantt only because
    // `emit` doesn't exist inside a bare composable.
    const unsubs: Array<() => void> = [
      instance.on('task:added', (task) => emit('task-added', task)),
      instance.on('task:moved', (task, prevStart) => emit('task-moved', task, prevStart)),
      instance.on('task:resized', (task, prevDuration) => emit('task-resized', task, prevDuration)),
      instance.on('task:progressed', (task, prevProgress) =>
        emit('task-progressed', task, prevProgress),
      ),
      instance.on('task:removed', (taskId) => emit('task-removed', taskId)),
      instance.on('dependency:added', (dep) => emit('dependency-added', dep)),
      instance.on('dependency:removed', (depId) => emit('dependency-removed', depId)),
      instance.on('critical-path:computed', (ids) => emit('critical-path-computed', ids)),
    ];

    onBeforeUnmount(() => {
      for (const unsub of unsubs) unsub();
      // NOT instance.unmount() here — useFluxGantt's OWN onBeforeUnmount (registered first,
      // since useFluxGantt() was called before this onBeforeUnmount) already does that. See
      // §6 for the exact ordering guarantee and why it's safe either way.
    });

    // Full GanttInstance (resolution #2), not a curated subset — the Vue analogue of react's
    // useImperativeHandle. `expose()` replaces what a parent's template ref / `wrapper.vm`
    // sees; the raw container DOM node is never exposed, only reachable internally via
    // `containerRef`. Exposes a PRE-BOUND wrapper, not `instance` directly — see
    // `exposableInstance`'s doc-comment above for why (Vue's exposeProxy + core's `#private`
    // fields).
    expose(exposableInstance(instance));

    return () => h('div', { ref: containerRef, class: 'fg-gantt' });
  },
});
