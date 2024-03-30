import TaskQueueBase, { TaskQueueBaseProps } from './base';
import { MessageHub } from './message-hub';
import {
  TaskId,
  TaskPriority,
  TaskStatus,
  TaskStatusUpdateHandler,
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

export const MESSAGE_HUB_KEY = 'task-queue';

export interface TaskQueueProps extends TaskQueueBaseProps {}

/**
 * Task queue with concurrency control. By default, all added tasks will be auto
 * scheduled and executed. You can use stop() and start() to control the
 * execution.
 */
export class TaskQueue extends TaskQueueBase {
  private messageHub: MessageHub;

  constructor(props: TaskQueueProps = {}) {
    super(props);

    this.messageHub = new MessageHub();

    this.onTaskStatusUpdate = (status, task) => {
      this.messageHub.publish(MESSAGE_HUB_KEY, status, task);
    };
  }

  /**
   * Subscribe to the task status changes.
   * @param onTaskStatusUpdate The listener for task status updates
   */
  subscribeTaskStatusChange(onTaskStatusUpdate: TaskStatusUpdateHandler) {
    this.messageHub.subscribe(MESSAGE_HUB_KEY, onTaskStatusUpdate);
    return () => this.unsubscribeTaskStatusChange(onTaskStatusUpdate);
  }

  /**
   * Unsubscribe from the task status changes.
   * @param onTaskStatusUpdate The listener for task status updates
   */
  unsubscribeTaskStatusChange(onTaskStatusUpdate: TaskStatusUpdateHandler) {
    this.messageHub.unsubscribe(MESSAGE_HUB_KEY, onTaskStatusUpdate);
  }

  /**
   * Add a task with callback function to the queue.
   * @param callback The callback function of the task
   */
  addTask<ReturnType>(
    callback: () => ReturnType | Promise<ReturnType>,
  ): Promise<ReturnType>;

  /**
   * Add a task with callback function to the queue.
   * @param callback The callback function of the task
   * @param onStatusUpdate The callback function to subscribe task status
   * changes
   */
  addTask<ReturnType>(
    callback: () => ReturnType | Promise<ReturnType>,
    onStatusUpdate?: TaskStatusUpdateHandler<ReturnType>,
  ): Promise<ReturnType>;

  /**
   * Add a task with callback function to the queue.
   * @param callback The callback function of the task
   * @param taskId The ID of the task
   * @param onStatusUpdate The callback function to subscribe task status
   * changes
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
        this._createTask(callback, taskIdOrOnStatusUpdate, onStatusUpdate),
      );
    } else {
      return this._addTask(
        this._createTask(callback, undefined, taskIdOrOnStatusUpdate),
      );
    }
  }

  /**
   * Add a task with callback function to the prioritized queue.
   * @param callback The callback function of the task
   */
  addPrioritizedTask<ReturnType>(
    callback: () => ReturnType | Promise<ReturnType>,
  ): Promise<ReturnType>;

  /**
   * Add a task with callback function to the prioritized queue.
   * @param callback The callback function of the task
   * @param onStatusUpdate The callback function to subscribe task status
   * changes
   */
  addPrioritizedTask<ReturnType>(
    callback: () => ReturnType | Promise<ReturnType>,
    onStatusUpdate?: TaskStatusUpdateHandler<ReturnType>,
  ): Promise<ReturnType>;

  /**
   * Add a task with callback function to the prioritized queue.
   * @param callback The callback function of the task
   * @param taskId The ID of the task
   * @param onStatusUpdate The callback function to subscribe task status
   * changes
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
      return this._addTask(
        this._createTask(
          callback,
          taskIdOrOnStatusUpdate,
          onStatusUpdate,
          'important',
        ),
      );
    } else {
      return this._addTask(
        this._createTask(
          callback,
          undefined,
          taskIdOrOnStatusUpdate,
          'important',
        ),
      );
    }
  }

  /**
   * Add tasks with callback functions to the queue.
   * @param tasks The array of tasks with callback functions, IDs, task status
   * update subscribers, and priorities
   */
  async addTasks(
    tasks: Array<{
      callback: () => unknown;
      taskId?: TaskId;
      onStatusUpdate?: TaskStatusUpdateHandler<unknown>;
      priority?: TaskPriority;
    }>,
  ) {
    return Promise.all(
      tasks.map((task) => {
        if (task.priority === 'important') {
          return this.addPrioritizedTask(
            task.callback,
            task.taskId ?? getTaskId(),
            task.onStatusUpdate,
          );
        } else {
          return this.addTask(
            task.callback,
            task.taskId ?? getTaskId(),
            task.onStatusUpdate,
          );
        }
      }),
    );
  }

  /**
   * Clear all waited tasks from the queue.
   */
  clearWaitedTasks() {
    this.tasksWaitingQueue = [];
    this.prioritizedTasksWaitingQueue = [];
  }

  /**
   * Clear all failed retryable tasks from the queue.
   */
  clearFailedRetryableTasks() {
    this.failedRetryableTaskQueue = [];
  }

  /** @internal */
  private _assertMemorizingTasksEnabled() {
    if (!this.memorizeTasks) {
      throw Error('Memorizing task details is not enabled');
    }
  }

  /**
   * Get the task details with task ID.
   * @param taskId The ID of the task
   */
  getTaskDetails(taskId: TaskId) {
    this._assertMemorizingTasksEnabled();

    return this.taskLookup[taskId];
  }

  /**
   * Get all task details with optional matching status.
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
   * Clear the task details with task ID.
   * @param taskId The ID of the task
   */
  clearTaskDetails(taskId: TaskId) {
    this._assertMemorizingTasksEnabled();

    delete this.taskLookup[taskId];
  }

  /**
   * Clear all task details.
   */
  clearAllTasksDetails() {
    this._assertMemorizingTasksEnabled();

    this.taskLookup = {};
  }
}

export default TaskQueue;
