import {
  TaskId,
  TaskStatus,
  Resolve,
  Task,
  WaitedTask,
  PromiseQueue,
} from "./types";
import { getRandomTaskId, isWaitedTask } from "./utils";

export interface TaskQueueProps {
  concurrency: number;
  catchError?: boolean;
  memorizeTasks?: boolean;
}

export class TaskQueue {
  private catchError: boolean;
  private memorizeTasks: boolean;
  private promiseQueues: Array<PromiseQueue> = [];
  private promiseQueueCapacity: number = 1;
  private taskLookup: Record<TaskId, Task> = {};
  private tasksWaitingQueue: Array<WaitedTask> = [];

  constructor({ concurrency, catchError, memorizeTasks }: TaskQueueProps) {
    if (concurrency < 1) {
      throw Error(`Invalid concurrency ${concurrency}`);
    }

    this.catchError = catchError ?? false;
    this.memorizeTasks = memorizeTasks ?? false;

    this.promiseQueues = new Array(concurrency).fill(null).map((_, index) => ({
      queueId: index,
      promise: Promise.resolve(),
      length: 0,
      taskIds: [],
    }));
  }

  private _getAvailablePromiseQueue() {
    let bestQueueIndex = -1;
    let bestLength = Infinity;
    this.promiseQueues.forEach((queue, index) => {
      if (queue.length < bestLength) {
        bestLength = queue.length;
        bestQueueIndex = index;
      }
    });

    return this.promiseQueues[bestQueueIndex];
  }

  private async _run<ReturnType>(
    task: Task<ReturnType>,
    resolve: Resolve<ReturnType>
  ) {
    try {
      if (task.status === "idle") {
        task.status = "running";
        const result = await task.callback();
        resolve(result);
        task.status = "success";
      } else {
        throw Error(
          `Task ${task.taskId} is already executed with status ${task.status}`
        );
      }
    } catch (error: any) {
      task.status = "error";

      if (this.catchError) {
        resolve(error);
      } else {
        throw error;
      }
    }
  }

  private _addTask<ReturnType>(
    task: Task<ReturnType> | WaitedTask<ReturnType>
  ) {
    if (this.memorizeTasks) {
      this.taskLookup[task.taskId] = task;
    }

    const _isWaitedTask = isWaitedTask(task);

    // the waited task already has the resolve function
    let _resolve: Resolve<ReturnType>;
    if (_isWaitedTask) {
      _resolve = task.resolve;
    }

    // the waited task already has the promise
    const _promise: Promise<ReturnType> = _isWaitedTask
      ? task.promise
      : new Promise((resolve) => {
          _resolve = resolve;
        });

    const promiseQueue = this._getAvailablePromiseQueue();

    // if the promise queue reaches to its capacity, append the task to the waiting queue
    if (promiseQueue.length >= this.promiseQueueCapacity) {
      setTimeout(() => {
        this.tasksWaitingQueue.push({
          ...task,
          resolve: _resolve,
          promise: _promise,
        });
      });
    }

    // if the promise queue does not reach to its capacity, append the task to the promise queue
    else {
      promiseQueue.length += 1;
      promiseQueue.taskIds.push(task.taskId);

      promiseQueue.promise.then(() =>
        this._run(task, (result: ReturnType) => {
          promiseQueue.length -= 1;
          promiseQueue.taskIds.shift();

          _resolve(result);

          // get and re-add the first task from the waiting queue after the previous "setTimeout" finishes appending tasks to the waiting queue
          setTimeout(() => {
            const nextTask = this.tasksWaitingQueue.shift();

            if (nextTask) {
              this._addTask(nextTask);
            }
          });
        })
      );

      // append the promise to the promise queue to serialize async task executions
      promiseQueue.promise = _promise;
    }

    // return the result from the original callback function of the task
    return _promise;
  }

  async addTask<ReturnType>(
    callback: () => ReturnType | Promise<ReturnType>,
    taskId?: TaskId
  ) {
    return this._addTask({
      taskId: taskId ?? getRandomTaskId(),
      callback,
      createdAt: new Date().getTime(),
      status: "idle",
    });
  }

  async addTasks<ReturnType>(
    callback: () => (ReturnType | Promise<ReturnType>) | Array<() => unknown>,
    taskId?: TaskId | Array<TaskId>
  ) {
    if (
      Array.isArray(callback) &&
      (Array.isArray(taskId) || taskId === undefined)
    ) {
      if (taskId?.length && callback.length !== taskId.length) {
        throw Error(
          `Callbacks count ${callback.length} does not match the task IDs count ${taskId.length}`
        );
      } else {
        const result: Array<Promise<unknown>> = [];
        for (let i = 0; i < callback.length; i++) {
          result.push(
            this.addTask(callback[i], taskId?.[i] ?? getRandomTaskId())
          );
        }

        return Promise.all(result);
      }
    } else if (!Array.isArray(callback) && !Array.isArray(taskId)) {
      return this.addTask(callback, taskId ?? getRandomTaskId());
    } else {
      throw Error("Either callback or task ID is array");
    }
  }

  getTask(taskId: TaskId) {
    return this.taskLookup[taskId];
  }

  getAllTasks(status?: TaskStatus | Array<TaskStatus>) {
    const allTasks = Object.values(this.taskLookup);

    if (Array.isArray(status)) {
      return allTasks.filter((task) => status.includes(task.status));
    } else {
      return status
        ? allTasks.filter((task) => task.status === status)
        : allTasks;
    }
  }

  clearTask(taskId: TaskId) {
    delete this.taskLookup[taskId];
  }

  clearAllTasks() {
    this.taskLookup = {};
  }
}

export default TaskQueue;
