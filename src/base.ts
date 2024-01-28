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

export interface TaskQueueBaseProps {
  /**
   * If true, print console logs of the task queue execution details
   * @default false
   */
  verbose?: boolean;
  /**
   * Maximum number of the concurrent running tasks
   * @default 1
   */
  concurrency?: number;
  /**
   * If true, the error of executing the tasks will be returned (resolved to the returning promise)
   * @default false
   */
  returnError?: boolean;
  /**
   * Listener for task status updates. Please note, only one listener is allowed
   */
  onTaskStatusUpdate?: TaskStatusUpdateHandler;
}

/**
 * Base abstract class for task queue, which is only responsible for serialized tasks execution and
 * should not expose any public methods
 */
export abstract class TaskQueueBase {
  /** @internal */
  private verbose: boolean;
  /** @internal */
  private returnError: boolean;
  /** @internal */
  protected promiseQueues: Array<PromiseQueue> = [];
  /** @internal */
  protected taskLookup: Record<TaskId, Task> = {};
  /** @internal */
  protected onTaskStatusUpdate: TaskStatusUpdateHandler | undefined = undefined;

  constructor({
    verbose = false,
    concurrency = 1,
    returnError = false,
    onTaskStatusUpdate,
  }: TaskQueueBaseProps = {}) {
    if (concurrency < 1) {
      throw Error(`Invalid concurrency ${concurrency}`);
    }

    this.verbose = verbose;
    this.returnError = returnError;
    this.onTaskStatusUpdate = onTaskStatusUpdate;

    this.promiseQueues = new Array(concurrency).fill(null).map((_, index) => ({
      queueId: index,
      promise: Promise.resolve(),
      length: 0,
      taskIds: [],
    }));
  }

  /** @internal */
  protected abstract _getAvailablePromiseQueue():
    | PromiseQueue
    | undefined
    | null;
  /** @internal */
  protected abstract _pushTaskToWaitingQueue(task: Task): void;
  /** @internal */
  protected abstract _getNextTask(): WaitedTask | undefined | null;
  /** @internal */
  protected abstract _shouldStop(task: Task): boolean;

  /** @internal */
  protected _log(...data: Array<any>) {
    if (this.verbose) {
      console.log(...data);
    }
  }

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
      if (task.status === 'idle') {
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
    this._log('Processing task:\n', task);

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
    this._log('Get promise queue:\n', promiseQueue);

    // If there is no available promise queue or we should stop the execution, append the task to the waiting queue
    if (!promiseQueue || this._shouldStop(task)) {
      Promise.resolve().then(() => {
        this._pushTaskToWaitingQueue({
          ...task,
          resolve: _resolve,
          reject: _reject,
          promise: _promise,
        } as WaitedTask);
      });
    }

    // If there is an available promise queue, append the task to it
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
        this._log(
          `Resolved task ${task.taskId} with result or error ${result}`,
        );

        // If stopped, directly return to skip the execution of next task
        if (this._shouldStop(task)) {
          return;
        }

        // Get and re-add the first task from the waiting queue after the previous "Promise.resolve().then()" finishes appending tasks to the waiting queue
        Promise.resolve().then(() => {
          const nextTask = this._getNextTask();
          if (nextTask) {
            this._addTask(nextTask);
            this._log(
              `Picked the next task ${nextTask.taskId} to continue execution`,
            );
          }
        });
      };

      const runTask = () => {
        this._log(`Running task ${task.taskId}`);

        return this._runTask(
          task,
          (result) => {
            resolveTask(result, _resolve);
          },
          (error) => {
            resolveTask(error, _reject);
          },
        );
      };

      // Keep running tasks no matter the previous task is resolved or rejected
      // NOTE: You do not need to change this for most cases
      promiseQueue.promise.then(runTask).catch(runTask);

      // Append the promise to the promise queue to serialize async task executions
      // NOTE: You do not need to change this for most cases
      promiseQueue.promise = _promise;
    }

    // Return the result from the original callback function of the task
    // NOTE: You do not need to change this for most cases
    return _promise;
  }
}

export default TaskQueueBase;
