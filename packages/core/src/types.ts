// Core type system (spec §6). Branded ID + DateInput chuẩn hoá về Temporal nội bộ.
import type { Temporal } from '@js-temporal/polyfill';

// Branded ID types — ngăn trộn lẫn ID ở compile time (spec §6.1)
export type Brand<T, B> = T & { readonly __brand: B };

export type TaskId = Brand<string, 'TaskId'>;
export type ResourceId = Brand<string, 'ResourceId'>;
export type DependencyId = Brand<string, 'DependencyId'>;
export type BaselineId = Brand<string, 'BaselineId'>;
export type ProjectId = Brand<string, 'ProjectId'>;

// Coercion ở boundary: API công khai nhận string, core brand nội bộ (spec §6.1).
// Người dùng không phải tự `as TaskId`.
export const toTaskId = (s: string): TaskId => s as TaskId;
export const toResourceId = (s: string): ResourceId => s as ResourceId;
export const toDependencyId = (s: string): DependencyId => s as DependencyId;
export const toBaselineId = (s: string): BaselineId => s as BaselineId;
export const toProjectId = (s: string): ProjectId => s as ProjectId;

// Mọi mốc lịch trình nhận nhiều dạng ở input, chuẩn hoá về Temporal nội bộ (spec §6.2)
export type DateInput = string | Date | Temporal.ZonedDateTime | Temporal.PlainDate;

export type DependencyType =
  | 'FS' // Finish-to-Start (mặc định)
  | 'SS' // Start-to-Start
  | 'FF' // Finish-to-Finish
  | 'SF'; // Start-to-Finish (hiếm)

export type TaskKind = 'task' | 'summary' | 'milestone' | 'project';

export type TaskConstraint =
  | { kind: 'asap' }
  | { kind: 'alap' }
  | { kind: 'must-start-on'; date: DateInput }
  | { kind: 'must-finish-on'; date: DateInput }
  | { kind: 'start-no-earlier-than'; date: DateInput }
  | { kind: 'start-no-later-than'; date: DateInput }
  | { kind: 'finish-no-earlier-than'; date: DateInput }
  | { kind: 'finish-no-later-than'; date: DateInput };

export interface ResourceAssignment {
  resourceId: ResourceId;
  units: number; // 0..1 = % allocation
}

export interface Task {
  id: TaskId;
  name: string;
  start: DateInput; // chuẩn hoá về Temporal nội bộ
  end: DateInput;
  duration?: number; // working hour; derive từ start/end nếu thiếu
  progress: number; // 0..1
  priority?: number; // số nhỏ = ưu tiên cao; dùng cho resource leveling (spec §13.2)
  parent?: TaskId;
  type: TaskKind;
  constraint?: TaskConstraint;
  resources?: ResourceAssignment[]; // Pro
  notes?: string;
  color?: string; // validate whitelist khi render (xem security rule)
  meta?: Record<string, unknown>; // field tự do của user — untrusted khi hiển thị
  createdAt: Date;
  updatedAt: Date;
}

export interface Dependency {
  id: DependencyId;
  from: TaskId;
  to: TaskId;
  type: DependencyType;
  lag?: number; // giờ; âm = lead time
}
