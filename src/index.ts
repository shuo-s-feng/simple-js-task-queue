import TaskQueueBase, { TaskQueueBaseProps } from './base';
import {
  Task,
  TaskId,
  TaskPrioritizationMode,
  TaskPriority,
  TaskStatus,
  TaskStatusUpdateHandler,
  WaitedTask,
  isTaskId,
} from './type';
import { getTaskId } from './utils';
export type {
  TaskId,
  TaskStatus,
  QueueId,
  TaskPrioritizationMode,
  Task,
} from './type';

const PROMISE_QUEUE_CAPACITY = 1;

export interface TaskQueueProps extends TaskQueueBaseProps {
  /**
   * If true, getTask() and getAllTasks() will be available to retrieve task details
   * @default false
   */
  memorizeTasks?: boolean;
  /**
   * If true, the error of executing the tasks will stop the queue execution
   * @default true
   */
  stopOnError?: boolean;
  /**
   * Pending task prioritization mode. It affects how the task queue picks the next task to be executed.
   * Please note, the task queue will auto execute the tasks whenever given, the first task will always be executed first no matter which priority mode is selected
   *
   * @augments head - Pick the first task in the waited queue
   *
   * @augments tail - Pick the last task in the waited queue
   *
   * @augments head-with-truncation - Pick the first task in the waited queue and clear the waited queue
   *
   * @augments tail-with-truncation - Pick the last task in the waited queue and clear the waited queue
   */
  taskPrioritizationMode?: TaskPrioritizationMode;
}

/**
 * Task queue with concurrency control. By default, all added tasks will be auto scheduled and executed. You can use stop() and start() to control the execution
 */
export class TaskQueue extends TaskQueueBase {
  /** @internal */
  private memorizeTasks: boolean;
  /** @internal */
  private stopOnError: boolean;
  /** @internal */
  private stopped: boolean = false;
  /** @internal */
  private promiseQueueCapacity: number = PROMISE_QUEUE_CAPACITY;
  /** @internal */
  private taskPrioritizationMode: TaskPrioritizationMode;
  /** @internal */
  protected tasksWaitingQueue: Array<WaitedTask> = [];
  /** @internal */
  protected prioritizedTasksWaitingQueue: Array<WaitedTask> = [];
  /** @internal */
  protected failedRetryableTaskQueue: Array<Task> = [];
  /** @internal */
  protected taskLookup: Record<TaskId, Task> = {};

  constructor({
    memorizeTasks = false,
    stopOnError = true,
    taskPrioritizationMode = 'head',
    ...rest
  }: TaskQueueProps = {}) {
    super(rest);

    this.memorizeTasks = memorizeTasks;
    this.stopOnError = stopOnError;
    this.taskPrioritizationMode = taskPrioritizationMode;
  }

  /** @internal */
  protected _getAvailablePromiseQueue() {
    let bestQueueIndex = -1;
    let bestLength = Infinity;
    this.promiseQueues.forEach((queue, index) => {
      if (queue.length < bestLength) {
        bestLength = queue.length;
        bestQueueIndex = index;
      }
    });

    const promiseQueue = this.promiseQueues[bestQueueIndex];
    return promiseQueue.length >= this.promiseQueueCapacity
      ? null
      : promiseQueue;
  }

  protected _pushTaskToWaitingQueue(task: WaitedTask) {
    if (task.priority === 'normal') {
      this.tasksWaitingQueue.push(task);
      this._log(
        {
          level: 'info',
          taskId: task.taskId,
        },
        `Pushed task ${task.taskId} to waiting queue`,
      );
    } else {
      this.prioritizedTasksWaitingQueue.push(task);
      this._log(
        {
          level: 'info',
          taskId: task.taskId,
        },
        `Pushed task ${task.taskId} to prioritized waiting queue`,
      );
    }
  }

  /** @internal */
  protected _getNextTask() {
    // First consider the prioritized waiting queue
    const queue = this.prioritizedTasksWaitingQueue.length
      ? this.prioritizedTasksWaitingQueue
      : this.tasksWaitingQueue;

    switch (this.taskPrioritizationMode) {
      case 'head': {
        return queue.shift();
      }

      case 'head-with-truncation': {
        const nextTask = queue.shift();
        if (this.prioritizedTasksWaitingQueue.length) {
          this.prioritizedTasksWaitingQueue = [];
        } else {
          this.tasksWaitingQueue = [];
        }
        return nextTask;
      }

      case 'tail': {
        return queue.pop();
      }

      case 'tail-with-truncation': {
        const nextTask = queue.pop();
        if (this.prioritizedTasksWaitingQueue.length) {
          this.prioritizedTasksWaitingQueue = [];
        } else {
          this.tasksWaitingQueue = [];
        }
        return nextTask;
      }

      default: {
        throw Error(
          `Invalid task priority mode ${this.taskPrioritizationMode}`,
        );
      }
    }
  }

  /** @internal */
  protected _shouldStop(task: Task): boolean {
    // If the current task has error and the queue should stop on error, or queue should stop, do not continue the execution
    if (task.error && this.stopOnError) {
      this.failedRetryableTaskQueue.push(task);
      this._log(
        {
          level: 'info',
          taskId: task.taskId,
        },
        `Stopped queue due to the error ${task.error} from the task ${task.taskId}`,
      );
      return true;
    }

    if (this.stopped) {
      this._log(
        {
          level: 'info',
          taskId: task.taskId,
        },
        `Stopped queue as it should stop`,
      );
      return true;
    }

    return false;
  }

  createTask<ReturnType>(
    callback: () => ReturnType | Promise<ReturnType>,
    taskId?: TaskId,
    onStatusUpdate?: TaskStatusUpdateHandler<ReturnType>,
    priority: TaskPriority = 'normal',
  ) {
    const finalTaskId = taskId ?? getTaskId();

    const task = {
      taskId: finalTaskId,
      callback,
      createdAt: new Date().getTime(),
      status: 'idle' as TaskStatus,
      onStatusUpdate,
      priority,
    };

    if (this.memorizeTasks) {
      this.taskLookup[finalTaskId] = task;
    }

    return task;
  }

  /**
   * Add a task with callback function to the queue
   * @param callback The callback function of the task
   */
  addTask<ReturnType>(
    callback: () => ReturnType | Promise<ReturnType>,
  ): Promise<ReturnType>;

  /**
   * Add a task with callback function to the queue
   * @param callback The callback function of the task
   * @param onStatusUpdate The callback function to subscribe task status changes
   */
  addTask<ReturnType>(
    callback: () => ReturnType | Promise<ReturnType>,
    onStatusUpdate?: TaskStatusUpdateHandler<ReturnType>,
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
    onStatusUpdate?: TaskStatusUpdateHandler<ReturnType>,
  ): Promise<ReturnType>;

  /** @internal */
  async addTask<ReturnType>(
    callback: () => ReturnType | Promise<ReturnType>,
    taskIdOrOnStatusUpdate?: TaskId | TaskStatusUpdateHandler<ReturnType>,
    onStatusUpdate?: TaskStatusUpdateHandler<ReturnType>,
  ): Promise<ReturnType> {
    if (
      isTaskId(taskIdOrOnStatusUpdate) ||
      taskIdOrOnStatusUpdate === undefined
    ) {
      return this._addTask(
        this.createTask(callback, taskIdOrOnStatusUpdate, onStatusUpdate),
      );
    } else {
      return this._addTask(
        this.createTask(callback, undefined, taskIdOrOnStatusUpdate),
      );
    }
  }

  /**
   * Add a task with callback function to the prioritized queue
   * @param callback The callback function of the task
   */
  addPrioritizedTask<ReturnType>(
    callback: () => ReturnType | Promise<ReturnType>,
  ): Promise<ReturnType>;

  /**
   * Add a task with callback function to the prioritized queue
   * @param callback The callback function of the task
   * @param onStatusUpdate The callback function to subscribe task status changes
   */
  addPrioritizedTask<ReturnType>(
    callback: () => ReturnType | Promise<ReturnType>,
    onStatusUpdate?: TaskStatusUpdateHandler<ReturnType>,
  ): Promise<ReturnType>;

  /**
   * Add a task with callback function to the prioritized queue
   * @param callback The callback function of the task
   * @param taskId The ID of the task
   * @param onStatusUpdate The callback function to subscribe task status changes
   */
  addPrioritizedTask<ReturnType>(
    callback: () => ReturnType | Promise<ReturnType>,
    taskId?: TaskId | undefined,
    onStatusUpdate?: TaskStatusUpdateHandler<ReturnType>,
  ): Promise<ReturnType>;

  /** @internal */
  async addPrioritizedTask<ReturnType>(
    callback: () => ReturnType | Promise<ReturnType>,
    taskIdOrOnStatusUpdate?: TaskId | TaskStatusUpdateHandler<ReturnType>,
    onStatusUpdate?: TaskStatusUpdateHandler<ReturnType>,
  ): Promise<ReturnType> {
    if (
      isTaskId(taskIdOrOnStatusUpdate) ||
      taskIdOrOnStatusUpdate === undefined
    ) {
      return this._addTask({
        taskId: taskIdOrOnStatusUpdate ?? getTaskId(),
        callback,
        createdAt: new Date().getTime(),
        status: 'idle',
        onStatusUpdate,
        priority: 'important',
      });
    } else {
      return this._addTask({
        taskId: getTaskId(),
        callback,
        createdAt: new Date().getTime(),
        status: 'idle',
        onStatusUpdate: taskIdOrOnStatusUpdate,
        priority: 'important',
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
    }>,
  ) {
    return Promise.all(
      tasks.map((task) =>
        this.addTask(
          task.callback,
          task.taskId ?? getTaskId(),
          task.onStatusUpdate,
        ),
      ),
    );
  }

  /** @internal */
  private _assertMemorizingTasksEnabled() {
    if (!this.memorizeTasks) {
      throw Error(
        'Memorizing task details is not enabled. Please update the memorizeTasks configuration when initializing the queue instance',
      );
    }
  }

  /**
   * Get the task details with task ID
   * @param taskId The ID of the task
   */
  getTaskDetails(taskId: TaskId) {
    this._assertMemorizingTasksEnabled();

    return this.taskLookup[taskId];
  }

  /**
   * Get all task details with matching status
   * @param status The matched status or array of statuses
   */
  getAllTasksDetails(status?: TaskStatus | Array<TaskStatus>) {
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
  clearTaskDetails(taskId: TaskId) {
    this._assertMemorizingTasksEnabled();

    delete this.taskLookup[taskId];
  }

  /**
   * Clear all task details
   */
  clearAllTasksDetails() {
    this._assertMemorizingTasksEnabled();

    this.taskLookup = {};
  }

  /**
   * Subscribe to the task status chagnes
   * @param onTaskStatusUpdate The listener for task status updates
   */
  subscribeTaskStatusChange(onTaskStatusUpdate: TaskStatusUpdateHandler) {
    this.onTaskStatusUpdate = onTaskStatusUpdate;
  }

  /**
   * Clear all waited tasks from the queue
   */
  clearWaitedTasks() {
    this.tasksWaitingQueue = [];
    this.prioritizedTasksWaitingQueue = [];
  }

  /**
   * Start the queue execution
   */
  start() {
    this.stopped = false;

    while (this.tasksWaitingQueue.length) {
      // Keep the original task orders and let the queue decide the next task to be executed later
      const task = this.tasksWaitingQueue.shift();
      if (task) {
        this._addTask(task);
      }
    }
  }

  /**
   * Stop the queue execution
   */
  stop() {
    this.stopped = true;
  }

  /**
   * Retry running the queue with failed tasks
   */
  retry() {
    while (this.failedRetryableTaskQueue.length) {
      const task = this.failedRetryableTaskQueue.shift();

      if (task) {
        this._addTask({
          ...task,
          // Reset important properties for the failed tasks
          result: undefined,
          error: undefined,
          status: 'idle',
          // To keep the original execution order, the failed tasks should have higher priority
          priority: 'important',
        });
      }
    }
  }
}

export default TaskQueue;
