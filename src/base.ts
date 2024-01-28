import TaskQueueCore, { TaskQueueCoreProps } from './core';
import {
  Task,
  TaskId,
  TaskPrioritizationMode,
  TaskStatusUpdateHandler,
  WaitedTask,
} from './type';

const PROMISE_QUEUE_CAPACITY = 1;

export interface TaskQueueBaseProps extends TaskQueueCoreProps {
  /**
   * If true, getTask() and getAllTasks() will be available to retrieve task details.
   * @default false
   */
  memorizeTasks?: boolean;
  /**
   * If true, the error of executing the tasks will stop the queue execution.
   * @default true
   */
  stopOnError?: boolean;
  /**
   * Pending task prioritization mode. It affects how the task queue picks the next task to be executed.
   * Please note, the task queue will auto execute the tasks whenever given, the first task will always be executed first no matter which priority mode is selected.
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
 * Base task queue with concurrency control.
 * By default, all added tasks will be auto scheduled and executed.
 * You can use stop() and start() to control the execution.
 */
export class TaskQueueBase extends TaskQueueCore {
  /** @internal */
  protected memorizeTasks: boolean;
  /** @internal */
  protected stopOnError: boolean;
  /** @internal */
  protected stopped: boolean = false;
  /** @internal */
  protected promiseQueueCapacity: number = PROMISE_QUEUE_CAPACITY;
  /** @internal */
  protected taskPrioritizationMode: TaskPrioritizationMode;
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
  }: TaskQueueBaseProps = {}) {
    super(rest);

    this.memorizeTasks = memorizeTasks;
    this.stopOnError = stopOnError;
    this.taskPrioritizationMode = taskPrioritizationMode;
  }

  /** @internal */
  protected _getAvailablePromiseQueue() {
    // Find any queue whose load is under capacity
    return (
      this.promiseQueues.find(
        (queue) => queue.length < this.promiseQueueCapacity,
      ) ?? null
    );
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
    // If the current task has error and the queue should stop on error,
    // or queue should stop, do not continue the execution.
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

export default TaskQueueBase;
