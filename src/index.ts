import TaskQueueBase, { TaskQueueBaseProps } from './base';
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

export interface TaskQueueProps extends TaskQueueBaseProps {}

/**
 * Task queue with concurrency control. By default, all added tasks will be auto scheduled and executed. You can use stop() and start() to control the execution
 */
export class TaskQueue extends TaskQueueBase {
  constructor(props: TaskQueueProps = {}) {
    super(props);
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
}

export default TaskQueue;
