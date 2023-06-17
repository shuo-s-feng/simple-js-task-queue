import {
	PromiseQueue,
	WaitedTask,
	Resolve,
	Reject,
	isWaitedTask,
	TaskStatusUpdateHandler,
	TaskId,
	Task,
	TaskStatus,
} from './type';

const PROMISE_QUEUE_CAPACITY = 1;

export interface TaskQueueBaseProps {
	/**
	 * Maximum number of the concurrent running tasks
	 */
	concurrency?: number;
	/**
	 * If true, the error of executing the tasks will be returned (resolved to the returning promise)
	 */
	returnError?: boolean;
	/**
	 * If true, getTask() and getAllTasks() will be available to retrieve task details
	 */
	memorizeTasks?: boolean;
	/**
	 * Listener for task status updates. Please note, only one listener is allowed
	 */
	onTaskStatusUpdate?: TaskStatusUpdateHandler;
}

export abstract class TaskQueueBase {
	/** @internal */
	private returnError: boolean;
	/** @internal */
	protected memorizeTasks: boolean;
	/** @internal */
	protected promiseQueues: Array<PromiseQueue> = [];
	/** @internal */
	private promiseQueueCapacity: number = PROMISE_QUEUE_CAPACITY;
	/** @internal */
	protected taskLookup: Record<TaskId, Task> = {};
	/** @internal */
	protected tasksWaitingQueue: Array<WaitedTask> = [];
	/** @internal */
	private taskIdRegistry: Set<TaskId> = new Set();
	/** @internal */
	protected onTaskStatusUpdate: TaskStatusUpdateHandler | undefined = undefined;

	constructor({
		concurrency = 1,
		returnError = false,
		memorizeTasks = false,
		onTaskStatusUpdate,
	}: TaskQueueBaseProps = {}) {
		if (concurrency < 1) {
			throw Error(`Invalid concurrency ${concurrency}`);
		}

		this.returnError = returnError;
		this.memorizeTasks = memorizeTasks;
		this.onTaskStatusUpdate = onTaskStatusUpdate;

		this.promiseQueues = new Array(concurrency).fill(null).map((_, index) => ({
			queueId: index,
			promise: Promise.resolve(),
			length: 0,
			taskIds: [],
		}));
	}

	/** @internal */
	protected abstract _getAvailablePromiseQueue(): PromiseQueue;
	/** @internal */
	protected abstract _getNextTask(): WaitedTask | undefined;
	/** @internal */
	protected abstract _shouldStop(): boolean;

	/** @internal */
	private _updateTaskStatus(task: Task, status: TaskStatus) {
		task.status = status;
		task.onStatusUpdate?.(status, task);
		this.onTaskStatusUpdate?.(status, task);
	}

	/** @internal */
	private async _runTask<ReturnType>(
		task: Task<ReturnType>,
		resolve: Resolve<ReturnType>,
		reject: Reject,
	) {
		try {
			if (!this.taskIdRegistry.has(task.taskId) && task.status === 'idle') {
				this.taskIdRegistry.add(task.taskId);

				task.runAt = new Date().getTime();
				this._updateTaskStatus(task, 'running');

				const result = await task.callback();
				resolve(result);

				task.result = result;
				this._updateTaskStatus(task, 'success');
				task.finishedAt = new Date().getTime();
			} else {
				throw Error(`Task ${task.taskId} is already triggered`);
			}
		} catch (error: any) {
			task.error = error;
			this._updateTaskStatus(task, 'error');

			if (this.returnError) {
				resolve(error);
			} else {
				reject(error);
			}
		}
	}

	/** @internal */
	protected _addTask<ReturnType>(
		task: Task<ReturnType> | WaitedTask<ReturnType>,
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

		// If the promise queue reaches to its capacity or the queue is stopped, append the task to the waiting queue
		if (
			promiseQueue.length >= this.promiseQueueCapacity ||
			this._shouldStop()
		) {
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
				resolve: Resolve<ReturnType> | Reject,
			) => {
				promiseQueue.length -= 1;
				promiseQueue.taskIds.shift();

				resolve(result as any);

				// Get and re-add the first task from the waiting queue after the previous "Promise.resolve().then()" finishes appending tasks to the waiting queue
				Promise.resolve().then(() => {
					// If stopped, directly return to skip the execution of next task
					if (this._shouldStop()) {
						return;
					}

					const nextTask = this._getNextTask();
					if (nextTask) {
						this._addTask(nextTask);
					}
				});
			};

			const runTask = () =>
				this._runTask(
					task,
					(result) => {
						resolveTask(result, _resolve);
					},
					(error) => {
						resolveTask(error, _reject);
					},
				);

			// Keep running tasks no matter the previous task is resolved or rejected
			promiseQueue.promise.then(runTask).catch(runTask);

			// Append the promise to the promise queue to serialize async task executions
			promiseQueue.promise = _promise;
		}

		// Return the result from the original callback function of the task
		return _promise;
	}
}

export default TaskQueueBase;
