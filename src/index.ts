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
  /**
   * Maximum number of the concurrent running tasks
   */
  concurrency: number;
  /**
   * If true, the error of executing the tasks will be returned (resolved to the returning promise)
   */
  returnError?: boolean;
  /**
   * If true, getTask() and getAllTasks() will be available to retrieve task details
   */
  memorizeTasks?: boolean;
}

export class TaskQueue {
  /** @internal */
  private returnError: boolean;
  /** @internal */
  private memorizeTasks: boolean;
  /** @internal */
  private promiseQueues: Array<PromiseQueue> = [];
  /** @internal */
  private promiseQueueCapacity: number = 1;
  /** @internal */
  private taskLookup: Record<TaskId, Task> = {};
  /** @internal */
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

  /** @internal */
  private _updateTaskStatus(task: Task, status: TaskStatus) {
    task.status = status;
    task.onStatusUpdate?.(status, task);
  }

  /** @internal */
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

  /** @internal */
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

  /** @internal */
  private _addTask<ReturnType>(
    task: Task<ReturnType> | WaitedTask<ReturnType>
  ) {
    if (this.memorizeTasks) {
      this.taskLookup[task.taskId] = task;
    }

    const _isWaitedTask = isWaitedTask(task);

    // The waited task already has the resolve function
    let _resolve: Resolve<ReturnType>;
    let _reject: Reject;
    if (_isWaitedTask) {
      _resolve = task.resolve;
      _reject = task.reject;
    }

    // The waited task already has the promise
    const _promise: Promise<ReturnType> = _isWaitedTask
      ? task.promise
      : new Promise((resolve, reject) => {
          _resolve = resolve;
          _reject = reject;
        });

    const promiseQueue = this._getAvailablePromiseQueue();

    // If the promise queue reaches to its capacity, append the task to the waiting queue
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

    // If the promise queue does not reach to its capacity, append the task to the promise queue
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

        // Get and re-add the first task from the waiting queue after the previous "Promise.resolve().then()" finishes appending tasks to the waiting queue
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

      // Keep running tasks no matter the previous task is resolved or rejected
      promiseQueue.promise.then(runTask).catch(runTask);

      // Append the promise to the promise queue to serialize async task executions
      promiseQueue.promise = _promise;
    }

    // Return the result from the original callback function of the task
    return _promise;
  }

  /**
   * Add a task with callback function to the queue
   * @param callback The callback function of the task
   */
  addTask<ReturnType>(
    callback: () => ReturnType | Promise<ReturnType>
  ): Promise<ReturnType>;

  /**
   * Add a task with callback function to the queue
   * @param callback The callback function of the task
   * @param onStatusUpdate The callback function to subscribe task status changes
   */
  addTask<ReturnType>(
    callback: () => ReturnType | Promise<ReturnType>,
    onStatusUpdate?: TaskStatusUpdateHandler<ReturnType>
  ): Promise<ReturnType>;

  /**
   * Add a task with callback function to the queue
   * @param callback The callback function of the task
   * @param taskId The ID of the task
   * @param onStatusUpdate The callback function to subscribe task status changes
   */
  addTask<ReturnType>(
    callback: () => ReturnType | Promise<ReturnType>,
    taskId?: TaskId | undefined,
    onStatusUpdate?: TaskStatusUpdateHandler<ReturnType>
  ): Promise<ReturnType>;

  /** @internal */
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

  /**
   * Add tasks with callback functions to the queue
   * @param tasks The array of tasks with callback functions, IDs, and task status changes subscriber
   */
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

  /** @internal */
  private _assertMemorizingTasksEnabled() {
    if (!this.memorizeTasks) {
      throw Error(
        "Memorizing task details is not enabled. Please update the memorizeTasks configuration when initializing the queue instance"
      );
    }
  }

  /**
   * Get the task details with task ID
   * @param taskId The ID of the task
   */
  getTask(taskId: TaskId) {
    this._assertMemorizingTasksEnabled();

    return this.taskLookup[taskId];
  }

  /**
   * Get all task details with matching status
   * @param status The matched status or array of statuses
   */
  getAllTasks(status?: TaskStatus | Array<TaskStatus>) {
    this._assertMemorizingTasksEnabled();

    const allTasks = Object.values(this.taskLookup);

    if (Array.isArray(status)) {
      return allTasks.filter((task) => status.includes(task.status));
    } else {
      return status
        ? allTasks.filter((task) => task.status === status)
        : allTasks;
    }
  }

  /**
   * Clear the task details with task ID
   * @param taskId The ID of the task
   */
  clearTask(taskId: TaskId) {
    this._assertMemorizingTasksEnabled();

    delete this.taskLookup[taskId];
  }

  /**
   * Clear all task details
   */
  clearAllTasks() {
    this._assertMemorizingTasksEnabled();

    this.taskLookup = {};
  }
}

export default TaskQueue;
