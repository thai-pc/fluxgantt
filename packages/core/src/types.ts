// Branded ID types — ngăn trộn lẫn ID ở compile time (spec §6.1)
export type Brand<T, B> = T & { readonly __brand: B };

export type TaskId = Brand<string, 'TaskId'>;
export type ResourceId = Brand<string, 'ResourceId'>;
export type DependencyId = Brand<string, 'DependencyId'>;
export type BaselineId = Brand<string, 'BaselineId'>;
export type ProjectId = Brand<string, 'ProjectId'>;

export type DependencyType =
  | 'FS' // Finish-to-Start (mặc định)
  | 'SS' // Start-to-Start
  | 'FF' // Finish-to-Finish
  | 'SF'; // Start-to-Finish (hiếm)

export type TaskKind = 'task' | 'summary' | 'milestone' | 'project';

// NOTE: stub tối thiểu cho Wave 1. Mở rộng theo spec §6.2 (Task, Dependency,
// TaskConstraint, Resource, Baseline, WorkingCalendar) khi implement.
export interface Task {
  id: TaskId;
  name: string;
  start: Date;
  end: Date;
  progress: number; // 0..1
  type: TaskKind;
  parent?: TaskId;
}

export interface Dependency {
  id: DependencyId;
  from: TaskId;
  to: TaskId;
  type: DependencyType;
  lag?: number;
}
