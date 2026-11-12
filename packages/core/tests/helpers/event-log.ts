// Golden event-log recorder (spec-mutation-batching.md §8 item 1, PR 0). Records every public
// event plus every `onTaskChange` call in global arrival order as short, deterministic strings,
// so a test can assert the EXACT sequence a mutation produces today. Random ids (`task-<uuid>`,
// `dep-<uuid>`) are replaced by first-seen labels so the logs are stable across runs.
import type { GanttEventName, GanttInstance } from '../../src/gantt.js';
import type { Dependency, Task } from '../../src/types.js';

const EVENT_NAMES: readonly GanttEventName[] = [
  'task:added',
  'task:moved',
  'task:updated',
  'task:resized',
  'task:progressed',
  'task:removed',
  'dependency:added',
  'dependency:removed',
  'critical-path:computed',
  'selection:changed',
  'collapse:changed',
  'history:changed',
  'data:imported',
  'viewport:changed',
  'renderer:selected',
  'conflict:detected',
];

const UUID = /(task|dep)-[0-9a-f]{8}-[0-9a-f-]{27}/g;

export interface EventRecorder {
  /** Entries in arrival order. */
  readonly log: string[];
  /** Pass as `GanttConfig.onTaskChange`. */
  readonly onTaskChange: (next: Task, prev: Task) => void;
  /** Subscribe to every event on `gantt`; returns an unsubscribe-all. */
  attach(gantt: GanttInstance): () => void;
  /** Drop everything recorded so far (call after setup, before the action under test). */
  clear(): void;
  /** Add a free-form marker (used to pin where a probe ran). */
  note(text: string): void;
}

export function createRecorder(): EventRecorder {
  const log: string[] = [];
  const labels = new Map<string, string>();
  const depLabels = new Map<string, string>();
  const relabel = (s: string): string =>
    s.replace(UUID, (m, kind: string) => {
      let l = labels.get(m);
      if (!l) {
        l = `${kind}-#${labels.size + 1}`;
        labels.set(m, l);
      }
      return l;
    });
  const dateOf = (v: unknown): string => relabel(String(v)).replace(/:00\+00:00\[UTC\]/g, '');
  const taskStr = (t: Task): string =>
    relabel(`${t.id}[${dateOf(t.start)}..${dateOf(t.end)} p=${t.progress}${t.parent ? ` parent=${t.parent}` : ''}]`);
  const depStr = (d: Dependency): string => relabel(`${d.from}>${d.to} ${d.type} lag=${d.lag ?? 0}`);
  const meta = (m: unknown): string => (m && typeof m === 'object' ? ` ${JSON.stringify(m)}` : '');

  const render = (name: GanttEventName, args: unknown[]): string => {
    switch (name) {
      case 'task:added':
        return `task:added ${taskStr(args[0] as Task)}${meta(args[1])}`;
      case 'task:moved':
        return `task:moved ${taskStr(args[0] as Task)} prevStart=${dateOf(args[1])}${meta(args[2])}`;
      case 'task:resized':
        return `task:resized ${taskStr(args[0] as Task)} prevDuration=${String(args[1])}${meta(args[2])}`;
      case 'task:progressed':
        return `task:progressed ${taskStr(args[0] as Task)} prev=${String(args[1])}${meta(args[2])}`;
      case 'task:updated': {
        const p = args[0] as { task: Task; changed: string[]; source?: string };
        return `task:updated ${taskStr(p.task)} changed=[${[...p.changed].sort().join(',')}]${meta(p.source ? { source: p.source } : undefined)}`;
      }
      case 'task:removed':
        return `task:removed ${relabel(String(args[0]))}${meta(args[1])}`;
      case 'dependency:added': {
        const d = args[0] as Dependency;
        depLabels.set(d.id, depStr(d));
        return `dependency:added ${depStr(d)}${meta(args[1])}`;
      }
      case 'dependency:removed': {
        const id = String(args[0]);
        return `dependency:removed ${depLabels.get(id) ?? relabel(id)}${meta(args[1])}`;
      }
      case 'conflict:detected':
        return `conflict:detected n=${(args[0] as unknown[]).length}`;
      default:
        return `${name} ${relabel(JSON.stringify(args[0]))}`;
    }
  };

  return {
    log,
    onTaskChange(next, prev) {
      log.push(`onTaskChange ${taskStr(next)} prev=[${dateOf(prev.start)}..${dateOf(prev.end)} p=${prev.progress}]`);
    },
    attach(gantt) {
      for (const d of gantt.getDependencies()) depLabels.set(d.id, depStr(d));
      const offs = EVENT_NAMES.map((name) =>
        (gantt.on as (n: GanttEventName, cb: (...a: unknown[]) => void) => () => void)(name, (...args) => {
          log.push(render(name, args));
        }),
      );
      return () => offs.forEach((off) => off());
    },
    clear() {
      log.length = 0;
    },
    note(text) {
      log.push(`-- ${text}`);
    },
  };
}
