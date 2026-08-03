// `<FluxGantt>` — the primary React API (resolution #3: component wraps the hook,
// spec-react-wrapper.md §4).
import { forwardRef, useImperativeHandle } from 'react';
import { useFluxGantt } from './use-flux-gantt.js';
import type { FluxGanttProps, FluxGanttRef } from './types.js';

/**
 * Note on construction-only props: `viewMode`/`density`/`locale`/`readOnly`/`calendar` are
 * read only once, when the underlying `GanttInstance` is created (`GanttInstance` has no
 * `setViewMode`/`setDensity`/`setLocale`/`setReadOnly`/`setCalendar`). Changing these props
 * after mount is a no-op. A consumer who needs a prop-driven `viewMode` change (etc.) can force
 * a full remount by changing `<FluxGantt>`'s `key`, e.g.
 * `<FluxGantt key={viewMode} viewMode={viewMode} ... />` — React tears down the old component
 * (and its instance) and mounts a fresh one.
 */
export const FluxGantt = forwardRef<FluxGanttRef, FluxGanttProps>(function FluxGantt(
  { className, style, ...config },
  forwardedRef,
) {
  const { ref: containerRef, instance } = useFluxGantt(config);

  // Full GanttInstance, not a curated subset (resolution #6). `instance` is stable across
  // renders (created once inside useFluxGantt), so this never re-runs after mount.
  useImperativeHandle(forwardedRef, () => instance, [instance]);

  return (
    <div
      ref={containerRef}
      className={className ? `fg-gantt ${className}` : 'fg-gantt'}
      style={style}
    />
  );
});
