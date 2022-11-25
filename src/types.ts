export type TaskId = string | number;
export type TaskStatus = "idle" | "running" | "success" | "error";
export type Resolve = (value: unknown) => void;

export interface Task {
  taskId: TaskId;
  callback: Function;
  createdAt: number;
  status: TaskStatus;
}

export interface WaitedTask extends Task {
  resolve: Resolve;
  promise: Promise<any>;
}

export interface PromiseQueue {
  queueId: number;
  promise: Promise<any>;
  length: number;
  taskIds: Array<TaskId>;
}
