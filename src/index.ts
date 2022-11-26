type TaskId = string | number;
type TaskStatus = "idle" | "running" | "success" | "error";
type QueueId = number;
type Resolve<ReturnType> = (value: ReturnType) => void;
type Reject = (error: Error) => void;
type TaskStatusUpdateHandler<ReturnType> = (
  status: TaskStatus,
  task: Task<ReturnType>
) => void;

interface Task<ReturnType = any> {
  taskId: TaskId;
  status: TaskStatus;
  callback: () => ReturnType | Promise<ReturnType>;
  onStatusUpdate?: TaskStatusUpdateHandler<ReturnType>;
  createdAt: number;
  queueId?: QueueId;
  result?: ReturnType;
  runAt?: number;
  finishedAt?: number;
}

interface WaitedTask<ReturnType = any> extends Task<ReturnType> {
  resolve: Resolve<ReturnType>;
  reject: Reject;
  promise: Promise<ReturnType>;
}

interface PromiseQueue {
  queueId: QueueId;
  promise: Promise<any>;
  length: number;
  taskIds: Array<TaskId>;
}

const RANDOM_BASE = 100000000;

const getRandomTaskId = () => Math.floor(Math.random() * RANDOM_BASE);

const isTaskId = (obj: any): obj is TaskId => {
  if (typeof obj === "string" || typeof obj === "number") {
    return true;
  }
  return false;
};

const isWaitedTask = (obj: any): obj is WaitedTask => {
  if (obj.resolve && obj.promise) {
    return true;
  }
  return false;
};

export interface TaskQueueProps {
  concurrency: number;
  returnError?: boolean;
  memorizeTasks?: boolean;
}

export class TaskQueue {
  private returnError: boolean;
  private memorizeTasks: boolean;
  private promiseQueues: Array<PromiseQueue> = [];
  private promiseQueueCapacity: number = 1;
  private taskLookup: Record<TaskId, Task> = {};
  private tasksWaitingQueue: Array<WaitedTask> = [];

  constructor({ concurrency, returnError, memorizeTasks }: TaskQueueProps) {
    if (concurrency < 1) {
      throw Error(`Invalid concurrency ${concurrency}`);
    }

    this.returnError = returnError ?? false;
    this.memorizeTasks = memorizeTasks ?? false;

    this.promiseQueues = new Array(concurrency).fill(null).map((_, index) => ({
      queueId: index,
      promise: Promise.resolve(),
      length: 0,
      taskIds: [],
    }));
  }

  private _updateTaskStatus(task: Task, status: TaskStatus) {
    task.status = status;
    task.onStatusUpdate?.(status, task);
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
    resolve: Resolve<ReturnType>,
    reject: Reject
  ) {
    try {
      if (task.status === "idle") {
        task.runAt = new Date().getTime();
        this._updateTaskStatus(task, "running");

        const result = await task.callback();
        resolve(result);

        task.result = result;
        this._updateTaskStatus(task, "success");
        task.finishedAt = new Date().getTime();
      } else {
        throw Error(
          `Task ${task.taskId} is already executed with status ${task.status}`
        );
      }
    } catch (error: any) {
      this._updateTaskStatus(task, "error");

      if (this.returnError) {
        resolve(error);
      } else {
        reject(error);
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
    let _reject: Reject;
    if (_isWaitedTask) {
      _resolve = task.resolve;
      _reject = task.reject;
    }

    // the waited task already has the promise
    const _promise: Promise<ReturnType> = _isWaitedTask
      ? task.promise
      : new Promise((resolve, reject) => {
          _resolve = resolve;
          _reject = reject;
        });

    const promiseQueue = this._getAvailablePromiseQueue();

    // if the promise queue reaches to its capacity, append the task to the waiting queue
    if (promiseQueue.length >= this.promiseQueueCapacity) {
      Promise.resolve().then(() => {
        this.tasksWaitingQueue.push({
          ...task,
          resolve: _resolve,
          reject: _reject,
          promise: _promise,
        });
      });
    }

    // if the promise queue does not reach to its capacity, append the task to the promise queue
    else {
      promiseQueue.length += 1;
      promiseQueue.taskIds.push(task.taskId);
      task.queueId = promiseQueue.queueId;

      const resolveTask = (
        result: ReturnType | Error,
        resolve: Resolve<ReturnType> | Reject
      ) => {
        promiseQueue.length -= 1;
        promiseQueue.taskIds.shift();

        resolve(result as any);

        // get and re-add the first task from the waiting queue after the previous "Promise.resolve().then()" finishes appending tasks to the waiting queue
        Promise.resolve().then(() => {
          const nextTask = this.tasksWaitingQueue.shift();

          if (nextTask) {
            this._addTask(nextTask);
          }
        });
      };

      const runTask = () =>
        this._run(
          task,
          (result) => {
            resolveTask(result, _resolve);
          },
          (error) => {
            resolveTask(error, _reject);
          }
        );

      // keep running tasks no matter the previous task is resolved or rejected
      promiseQueue.promise.then(runTask).catch(runTask);

      // append the promise to the promise queue to serialize async task executions
      promiseQueue.promise = _promise;
    }

    // return the result from the original callback function of the task
    return _promise;
  }

  addTask<ReturnType>(
    callback: () => ReturnType | Promise<ReturnType>
  ): Promise<ReturnType>;

  addTask<ReturnType>(
    callback: () => ReturnType | Promise<ReturnType>,
    onStatusUpdate?: TaskStatusUpdateHandler<ReturnType>
  ): Promise<ReturnType>;

  addTask<ReturnType>(
    callback: () => ReturnType | Promise<ReturnType>,
    taskId?: TaskId | undefined,
    onStatusUpdate?: TaskStatusUpdateHandler<ReturnType>
  ): Promise<ReturnType>;

  async addTask<ReturnType>(
    callback: () => ReturnType | Promise<ReturnType>,
    taskIdOrOnStatusUpdate?: TaskId | TaskStatusUpdateHandler<ReturnType>,
    onStatusUpdate?: TaskStatusUpdateHandler<ReturnType>
  ): Promise<ReturnType> {
    if (
      isTaskId(taskIdOrOnStatusUpdate) ||
      taskIdOrOnStatusUpdate === undefined
    ) {
      return this._addTask({
        taskId: taskIdOrOnStatusUpdate ?? getRandomTaskId(),
        callback,
        createdAt: new Date().getTime(),
        status: "idle",
        onStatusUpdate,
      });
    } else {
      return this._addTask({
        taskId: getRandomTaskId(),
        callback,
        createdAt: new Date().getTime(),
        status: "idle",
        onStatusUpdate: taskIdOrOnStatusUpdate,
      });
    }
  }

  async addTasks(
    tasks: Array<{
      callback: () => unknown;
      taskId?: TaskId;
      onStatusUpdate?: TaskStatusUpdateHandler<unknown>;
    }>
  ) {
    return Promise.all(
      tasks.map((task) =>
        this.addTask(
          task.callback,
          task.taskId ?? getRandomTaskId(),
          task.onStatusUpdate
        )
      )
    );
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
