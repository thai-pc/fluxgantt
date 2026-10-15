// Edit-hooks fixture (spec-host-edit-hooks.md §10) — driven by `tests/e2e/edit-hooks.spec.ts`,
// `tests/a11y/edit-hooks.spec.ts` and `tests/mobile/edit-hooks.spec.ts`. It is also the reference
// for the host recipes the docs describe: core emits `task:activated` / `task:context-requested`,
// the HOST builds the menu and the editor.
//
// Query params:
//   ?pad=N       append N filler tasks (N >= ~2000 selects the Canvas renderer)
//   ?readonly=1  `readOnly: true` (events must still fire)
//   ?nolinks=1   `enableDependencyDrag: false`
//   ?touch=1     also compose `withResponsive()` (the docs' recommended touch composition)
//   ?prevent=0   the host does NOT call `preventDefault()` on the context request
import { Temporal } from '@js-temporal/polyfill';
import { createGantt, toTaskId, type TaskInput } from '@fluxgantt/core';
import { withRender } from '@fluxgantt/core/render';
import { withInteraction } from '@fluxgantt/core/interaction';
import { withEditHooks } from '@fluxgantt/core/edit-hooks';
import { withResponsive } from '@fluxgantt/core/responsive';
import { withViewport } from '@fluxgantt/core/viewport';

(globalThis as { Temporal?: typeof Temporal }).Temporal ??= Temporal;

const params = new URLSearchParams(window.location.search);
const pad = Number(params.get('pad') ?? '0');

// Rows 0-4: a summary with two leaves (so Enter-on-summary vs Enter-on-leaf is testable), two
// flat leaves, the last one linked from `a`.
const named: TaskInput[] = [
  { id: toTaskId('sum'), name: 'Summary', start: '2026-08-03', end: '2026-08-14', progress: 0.3, type: 'summary' },
  { id: toTaskId('a'), name: 'Alpha', start: '2026-08-03', end: '2026-08-07', progress: 0.5, type: 'task', parent: toTaskId('sum') },
  { id: toTaskId('b'), name: 'Bravo', start: '2026-08-10', end: '2026-08-14', progress: 0, type: 'task', parent: toTaskId('sum') },
  { id: toTaskId('c'), name: 'Charlie', start: '2026-08-17', end: '2026-08-21', progress: 0, type: 'task' },
  { id: toTaskId('d'), name: 'Delta', start: '2026-08-24', end: '2026-08-28', progress: 0, type: 'task' },
];
const filler: TaskInput[] = Array.from({ length: Math.max(0, pad) }, (_, i) => ({
  id: toTaskId(`filler-${i}`),
  name: `Filler ${i}`,
  start: `2026-09-${String((i % 14) + 1).padStart(2, '0')}`,
  end: `2026-09-${String((i % 14) + 2).padStart(2, '0')}`,
  progress: 0,
  type: 'task' as const,
}));

const base = withInteraction(
  withRender(
    createGantt({
      tasks: [...named, ...filler],
      dependencies: [{ from: toTaskId('c'), to: toTaskId('d'), type: 'FS' }],
      ...(params.get('readonly') === '1' ? { readOnly: true } : {}),
      ...(params.get('nolinks') === '1' ? { enableDependencyDrag: false } : {}),
      ariaLabel: 'Edit hooks demo project',
    }),
  ),
);
const gantt = withEditHooks(withViewport(params.get('touch') === '1' ? withResponsive(base) : base));
const host = document.getElementById('gantt')!;

// Event log for the specs. Payload functions are dropped; `defaultPrevented` of every native
// `contextmenu` is recorded by a page-level BUBBLE listener (it runs after the library's).
interface LogEntry { readonly name: string; readonly payload: Record<string, unknown> }
const events: LogEntry[] = [];
const record = (name: string, payload: unknown): void => {
  const plain: Record<string, unknown> = {};
  if (Array.isArray(payload)) plain['ids'] = [...payload];
  else if (name === 'task:moved' || name === 'task:resized') plain['taskId'] = (payload as { id: string }).id;
  else if (name === 'dependency:added') {
    const d = payload as { from: string; to: string };
    plain['from'] = d.from;
    plain['to'] = d.to;
  } else {
    for (const [k, v] of Object.entries((payload ?? {}) as Record<string, unknown>)) {
      if (typeof v !== 'function') plain[k] = v;
    }
  }
  events.push({ name, payload: plain });
};
const anyOn = gantt.on.bind(gantt) as unknown as (name: string, cb: (first: unknown) => void) => void;
for (const name of ['task:activated', 'task:context-requested', 'selection:changed', 'task:moved', 'task:resized', 'dependency:added']) {
  anyOn(name, (p) => record(name, p));
}
document.addEventListener('contextmenu', (e) => record('native:contextmenu', { defaultPrevented: e.defaultPrevented }));

// --- Host recipe 1: accessible context menu -------------------------------------------------
let closeMenu: (() => void) | undefined;

/** Focus the row element of a task; the documented fallback when the opener is gone. */
function rowFor(taskId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(taskId)}"]`);
}
function restoreFocus(opener: HTMLElement | null, taskId: string): void {
  (opener?.isConnected ? opener : rowFor(taskId))?.focus();
}

gantt.on('task:context-requested', (p) => {
  if (params.get('prevent') !== '0') p.preventDefault();
  closeMenu?.();
  const opener = document.activeElement as HTMLElement | null;
  const taskId = String(p.taskId);

  const menu = document.createElement('ul');
  menu.className = 'demo-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Task actions');
  const rename = document.createElement('li');
  const del = document.createElement('li');
  for (const [li, label] of [[rename, 'Rename'], [del, 'Delete']] as const) {
    li.setAttribute('role', 'menuitem');
    li.tabIndex = -1;
    li.textContent = label; // never innerHTML: names are untrusted
    menu.append(li);
  }
  menu.style.left = `${Math.max(0, Math.min(p.clientX, window.innerWidth - 170))}px`;
  menu.style.top = `${Math.max(0, Math.min(p.clientY, window.innerHeight - 90))}px`;
  // Inside <main>: popups outside every landmark trip axe's `region` rule.
  document.querySelector('main')!.append(menu);

  const close = (restore: boolean): void => {
    menu.remove();
    document.removeEventListener('pointerdown', onOutside, true);
    closeMenu = undefined;
    if (restore) restoreFocus(opener, taskId);
  };
  const onOutside = (e: Event): void => {
    if (!menu.contains(e.target as Node)) close(false);
  };
  closeMenu = () => close(false);
  document.addEventListener('pointerdown', onOutside, true);

  const items: HTMLElement[] = [rename, del];
  const choose = (li: HTMLElement): void => {
    if (li === rename) {
      close(false);
      openRenameDialog(taskId, opener);
    } else {
      close(true);
      gantt.removeTask(toTaskId(taskId));
    }
  };
  menu.addEventListener('keydown', (e) => {
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]!.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i + items.length - 1) % items.length]!.focus(); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(items[i]!); }
    else if (e.key === 'Tab') { e.preventDefault(); close(true); }
  });
  for (const li of items) li.addEventListener('click', () => choose(li));
  rename.focus();
});

// --- Host recipe 2: rename dialog -----------------------------------------------------------
let dialogOpen = false;

function openRenameDialog(taskId: string, openerHint?: HTMLElement | null): void {
  if (dialogOpen) return;
  const task = gantt.getTask(toTaskId(taskId));
  if (!task) return;
  dialogOpen = true;
  const opener = openerHint ?? (document.activeElement as HTMLElement | null);

  const dlg = document.createElement('div');
  dlg.className = 'demo-dialog';
  dlg.setAttribute('role', 'dialog');
  dlg.setAttribute('aria-modal', 'true');
  dlg.setAttribute('aria-labelledby', 'demo-dialog-title');
  const h = document.createElement('h2');
  h.id = 'demo-dialog-title';
  h.textContent = 'Rename task';
  const label = document.createElement('label');
  label.htmlFor = 'demo-dialog-name';
  label.textContent = 'Task name';
  const input = document.createElement('input');
  input.id = 'demo-dialog-name';
  input.type = 'text';
  input.value = task.name;
  const save = document.createElement('button');
  save.type = 'button';
  save.textContent = 'Save';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  dlg.append(h, label, input, save, cancel);
  document.querySelector('main')!.append(dlg);

  const close = (): void => {
    dlg.remove();
    dialogOpen = false;
    restoreFocus(opener, taskId);
  };
  const commit = (): void => {
    const name = input.value.trim();
    if (name) gantt.updateTask(toTaskId(taskId), { name });
    close();
  };
  save.addEventListener('click', commit);
  cancel.addEventListener('click', close);
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter' && e.target === input) { e.preventDefault(); commit(); }
    else if (e.key === 'Tab') {
      // Minimal focus trap.
      const order = [input, save, cancel];
      const i = order.indexOf(document.activeElement as HTMLInputElement);
      e.preventDefault();
      order[(i + (e.shiftKey ? order.length - 1 : 1)) % order.length]!.focus();
    }
  });
  input.focus();
  input.select();
}

gantt.on('task:activated', (p) => openRenameDialog(String(p.taskId)));

gantt.mount(host);

if (import.meta.env.DEV) {
  const w = window as unknown as { __gantt?: typeof gantt; __events?: LogEntry[] };
  w.__gantt = gantt;
  w.__events = events;
}
