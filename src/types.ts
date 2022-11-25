export type TaskId = string | number;
export type TaskStatus = "idle" | "running" | "success" | "error";
export type Resolve<ReturnType> = (value: ReturnType) => void;

export interface Task<ReturnType = any> {
  taskId: TaskId;
  callback: () => ReturnType | Promise<ReturnType>;
  createdAt: number;
  status: TaskStatus;
}

export interface WaitedTask<ReturnType = any> extends Task<ReturnType> {
  resolve: Resolve<ReturnType>;
  promise: Promise<ReturnType>;
}

export interface PromiseQueue {
  queueId: number;
  promise: Promise<any>;
  length: number;
  taskIds: Array<TaskId>;
}
