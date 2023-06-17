import TaskQueueBase, { TaskQueueBaseProps } from './base';
import {
	TaskId,
	TaskPrioritizationMode,
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

export interface TaskQueueProps extends TaskQueueBaseProps {
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
	private stopped: boolean = false;
	/** @internal */
	private taskPrioritizationMode: TaskPrioritizationMode;

	constructor({
		taskPrioritizationMode = 'head',
		...rest
	}: TaskQueueProps = {}) {
		super(rest);

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

		return this.promiseQueues[bestQueueIndex];
	}

	/** @internal */
	protected _getNextTask() {
		switch (this.taskPrioritizationMode) {
			case 'head': {
				return this.tasksWaitingQueue.shift();
			}

			case 'head-with-truncation': {
				const nextTask = this.tasksWaitingQueue.shift();
				this.tasksWaitingQueue = [];
				return nextTask;
			}

			case 'tail': {
				return this.tasksWaitingQueue.pop();
			}

			case 'tail-with-truncation': {
				const nextTask = this.tasksWaitingQueue.pop();
				this.tasksWaitingQueue = [];
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
	protected _shouldStop(): boolean {
		return this.stopped;
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
			return this._addTask({
				taskId: taskIdOrOnStatusUpdate ?? getTaskId(),
				callback,
				createdAt: new Date().getTime(),
				status: 'idle',
				onStatusUpdate,
			});
		} else {
			return this._addTask({
				taskId: getTaskId(),
				callback,
				createdAt: new Date().getTime(),
				status: 'idle',
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
	}

	/**
	 * Stop the queue execution
	 */
	stop() {
		this.stopped = true;
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
}

export default TaskQueue;
