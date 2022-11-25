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
}

export class TaskQueue {
  private catchError: boolean;
  private promiseQueues: Array<PromiseQueue> = [];
  private promiseQueueCapacity: number = 1;
  private tasksWaitingQueue: Array<WaitedTask> = [];
  private taskLookup: Record<TaskId, Task> = {};

  constructor({ concurrency, catchError }: TaskQueueProps) {
    if (concurrency < 1) {
      throw Error(`Invalid concurrency ${concurrency}`);
    }

    this.catchError = catchError ?? false;

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

  private async _run(task: Task, resolve: Resolve) {
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

  private _addTask(task: Task | WaitedTask) {
    this.taskLookup[task.taskId] = task;

    const _isWaitedTask = isWaitedTask(task);

    // the waited task already has the resolve function
    let _resolve: Resolve;
    if (_isWaitedTask) {
      _resolve = task.resolve;
    }

    // the waited task already has the promise
    const _promise = _isWaitedTask
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
        this._run(task, (result: unknown) => {
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

  async addTask(
    callback: Function | Array<Function>,
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
            this._addTask({
              taskId: taskId?.[i] ?? getRandomTaskId(),
              callback: callback[i],
              createdAt: new Date().getTime(),
              status: "idle",
            })
          );
        }

        return Promise.all(result);
      }
    } else if (!Array.isArray(callback) && !Array.isArray(taskId)) {
      return this._addTask({
        taskId: taskId ?? getRandomTaskId(),
        callback,
        createdAt: new Date().getTime(),
        status: "idle",
      });
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
}

export default TaskQueue;
