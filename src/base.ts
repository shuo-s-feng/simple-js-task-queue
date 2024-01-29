import TaskQueueCore, { TaskQueueCoreProps } from './core';
import {
  Task,
  TaskId,
  TaskPrioritizationMode,
  TaskPriority,
  TaskStatus,
  TaskStatusUpdateHandler,
  WaitedTask,
} from './type';
import { getTaskId } from './utils';

const PROMISE_QUEUE_CAPACITY = 1;

export interface TaskQueueBaseProps extends TaskQueueCoreProps {
  /**
   * Toggle of making getTask() and getAllTasks() available to use.
   * task details.
   * @default false
   */
  memorizeTasks?: boolean;
  /**
   * Toggle of error during task execution stopping the queue.
   * @default true
   */
  stopOnError?: boolean;
  /**
   * Toggle of using default incremental task id
   * @default true
   */
  defaultIncrementalTaskId?: boolean;
  /**
   * Pending task prioritization mode. It affects how the task queue
   * picks the next task to be executed.
   * Please note, the task queue will auto execute the tasks whenever given,
   * the first task will always be executed first no matter which priority
   * mode is selected.
   *
   * @augments head - Pick the first task in the waited queue
   *
   * @augments tail - Pick the last task in the waited queue
   *
   * @augments head-with-truncation - Pick the first task in the waited queue
   * and clear the waited queue
   *
   * @augments tail-with-truncation - Pick the last task in the waited queue
   * and clear the waited queue
   */
  taskPrioritizationMode?: TaskPrioritizationMode;
}

/**
 * Base task queue with abstract methods implementation and base public methods.
 */
export class TaskQueueBase extends TaskQueueCore {
  /** @internal */
  protected memorizeTasks: boolean;
  /** @internal */
  protected stopOnError: boolean;
  /** @internal */
  protected defaultIncrementalTaskId: boolean;
  /** @internal */
  protected retrying: boolean = false;
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
    defaultIncrementalTaskId = true,
    taskPrioritizationMode = 'head',
    ...rest
  }: TaskQueueBaseProps = {}) {
    super(rest);

    this.memorizeTasks = memorizeTasks;
    this.stopOnError = stopOnError;
    this.defaultIncrementalTaskId = defaultIncrementalTaskId;
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

  /** @internal */
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
    let queue: Array<Task>;
    // If the queue instance is retrying the failed retryable tasks, then it
    // should first consider the failed retryable task queue
    if (this.retrying && this.failedRetryableTaskQueue.length) {
      queue = this.failedRetryableTaskQueue;
    }

    // Otherwise (not retrying or retrying while the failed retryable task
    // queue is empty), then first consider the prioritized task waiting queue
    else if (this.prioritizedTasksWaitingQueue.length) {
      queue = this.prioritizedTasksWaitingQueue;
    }

    // Otherwise (neither failed retryable task queue nor prioritized task
    // waiting queue is available), then consider the normal task waiting queue
    else {
      queue = this.tasksWaitingQueue;
    }

    // If the queue instance is retrying while there is no failed retryable
    // task queue, mark the queue as not retrying
    if (this.retrying && !this.failedRetryableTaskQueue.length) {
      this.retrying = false;
    }

    switch (this.taskPrioritizationMode) {
      case 'head': {
        return queue.shift();
      }

      case 'head-with-truncation': {
        const nextTask = queue.shift();

        // Clear the prioritized and normal task waiting queue
        if (queue === this.prioritizedTasksWaitingQueue) {
          this.prioritizedTasksWaitingQueue = [];
        } else if (queue === this.tasksWaitingQueue) {
          this.tasksWaitingQueue = [];
        }

        return nextTask;
      }

      case 'tail': {
        return queue.pop();
      }

      case 'tail-with-truncation': {
        const nextTask = queue.pop();

        // Clear the prioritized and normal task waiting queue
        if (queue === this.prioritizedTasksWaitingQueue) {
          this.prioritizedTasksWaitingQueue = [];
        } else if (queue === this.tasksWaitingQueue) {
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
        `Stopped queue due to the error ${task.error} from the task \
        ${task.taskId}`,
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

  /** @internal */
  protected _createTask<ReturnType>(
    callback: () => ReturnType | Promise<ReturnType>,
    taskId?: TaskId,
    onStatusUpdate?: TaskStatusUpdateHandler<ReturnType>,
    priority: TaskPriority = 'normal',
  ) {
    const finalTaskId = taskId ?? getTaskId(this.defaultIncrementalTaskId);

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
   * Start the queue execution
   */
  start() {
    this.stopped = false;
    const task = this._getNextTask();
    if (task) {
      this._addTask(task);
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
    this.retrying = true;
    this.stopped = false;
    const task = this._getNextTask();
    if (task) {
      this._addTask(task);
    }
  }
}

export default TaskQueueBase;
