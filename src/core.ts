import { ILogger, LoggerMethodNames, logger as defaultLogger } from './logger';
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

export interface TaskQueueCoreProps {
  /**
   * The logger instance.
   * @default The default logger
   */
  logger?: ILogger;
  /**
   * Toggle to log the task queue execution details.
   * @default false
   */
  verbose?: boolean;
  /**
   * Maximum concurrency running tasks.
   * @default 1
   */
  concurrency?: number;
  /**
   * Toggle to return the error during task execution (resolve to the promise).
   * @default false
   */
  returnError?: boolean;
  /**
   * Listener for task status updates.
   * Please note, only one listener is allowed.
   */
  onTaskStatusUpdate?: TaskStatusUpdateHandler;
}

/**
 * Core abstract class for task queue, which is only responsible for serialized
 * tasks execution and concurrency dynamic adjustment.
 */
export abstract class TaskQueueCore {
  /** @internal */
  private currentQueueId: number = 0;
  /** @internal */
  protected logger: ILogger;
  /** @internal */
  private verbose: boolean;
  /** @internal */
  protected concurrency: number;
  /** @internal */
  private returnError: boolean;
  /** @internal */
  protected promiseQueues: Array<PromiseQueue> = [];
  /** @internal */
  protected onTaskStatusUpdate: TaskStatusUpdateHandler | undefined = undefined;

  constructor({
    logger = defaultLogger,
    verbose = false,
    concurrency = 1,
    returnError = false,
    onTaskStatusUpdate,
  }: TaskQueueCoreProps = {}) {
    this.logger = logger;
    this.verbose = verbose;
    this.concurrency = concurrency;
    this.returnError = returnError;
    this.onTaskStatusUpdate = onTaskStatusUpdate;

    this.promiseQueues = this._initPromiseQueues(concurrency);
  }

  /** @internal */
  protected abstract _getAvailablePromiseQueue():
    | PromiseQueue
    | undefined
    | null;
  /** @internal */
  protected abstract _pushTaskToWaitingQueue(task: Task): void;
  /** @internal */
  protected abstract _getNextTask(): Task | undefined | null;
  /** @internal */
  protected abstract _shouldStop(task?: Task): boolean;

  /** @internal */
  private _initPromiseQueues(concurrency: number): Array<PromiseQueue> {
    if (concurrency < 1) {
      throw new Error('Concurrency must be at least 1');
    }

    return new Array(concurrency).fill(null).map(() => ({
      queueId: this.currentQueueId++,
      promise: Promise.resolve(),
      length: 0,
      taskIds: [],
    }));
  }

  /**
   * Adjust the concurrency.
   * @param newConcurrency The new concurrency
   * @param taskBalancingStrategy The existing running task balancing strategy
   */
  public adjustConcurrency(
    newConcurrency: number,
    taskBalancingStrategy: 'round-robin' = 'round-robin',
  ): void {
    if (newConcurrency !== this.concurrency) {
      const oldConcurrency = this.concurrency;
      this.concurrency = newConcurrency;

      this._log(
        { level: 'info' },
        `Adjusting concurrency from ${oldConcurrency} to ${newConcurrency}`,
      );

      const newPromiseQueue = this._initPromiseQueues(newConcurrency);

      // Lookup from new queue index to old queues
      let newQueueIndexToOldQueuesLookup: Record<
        number,
        Array<Omit<PromiseQueue, 'queueId'>>
      > = {};

      if (taskBalancingStrategy === 'round-robin') {
        this.promiseQueues.forEach((queue, index) => {
          const newQueueIndex = index % newConcurrency;

          if (!newQueueIndexToOldQueuesLookup[newQueueIndex]) {
            newQueueIndexToOldQueuesLookup[newQueueIndex] = [queue];
          } else {
            newQueueIndexToOldQueuesLookup[newQueueIndex].push(queue);
          }
        });
      } else {
        throw new Error(
          `Unknown task balancing strategy ${taskBalancingStrategy}`,
        );
      }

      // Based on the lookup from new queue index to old queues, re-assign the
      // tasks from old queues to new queues
      newPromiseQueue.forEach((queue, index) => {
        // Update the task ids of the new queue from all the tasks from the
        // corresponding old queues
        queue.taskIds = newQueueIndexToOldQueuesLookup[index]
          ? newQueueIndexToOldQueuesLookup[index].reduce((total, current) => {
              return [...total, ...current.taskIds];
            }, [] as Array<TaskId>)
          : [];

        // Update the task lengh of the new queue
        queue.length = queue.taskIds.length;

        // Update the promise of the new queue
        queue.promise = newQueueIndexToOldQueuesLookup[index]
          ? Promise.all(
              newQueueIndexToOldQueuesLookup[index].map(
                (oldQueue) => oldQueue.promise,
              ),
            )
          : Promise.resolve();

        // Let the new queue be the parent queue of all old queues
        newQueueIndexToOldQueuesLookup[index]?.forEach(
          (oldQueue) => (oldQueue.parentQueue = queue),
        );
      });

      // Update the promise queues
      this.promiseQueues = newPromiseQueue;

      // If the new concurrency is greater than the old one, add new tasks to
      // fully leverage the whole concurrency capacity
      if (oldConcurrency < newConcurrency && !this._shouldStop()) {
        for (let i = 0; i < newConcurrency - oldConcurrency; i++) {
          const task = this._getNextTask();

          if (task) {
            this._log(
              { level: 'info' },
              `Adding task ${task.taskId} to the queue due to extra 
              concurrency`,
            );

            this._addTask(task);
          }
        }
      }

      this._log(
        { level: 'info' },
        `Adjusted concurrency from ${oldConcurrency} to ${newConcurrency}`,
      );
    }
  }

  /**
   * Get the current concurrency of the queue
   */
  public getConcurrency(): number {
    return this.concurrency;
  }

  /** @internal */
  protected _log(
    config: {
      level: LoggerMethodNames;
      taskId?: TaskId;
    },
    ...messages: Array<any>
  ) {
    if (this.verbose) {
      if (config.taskId) {
        this.logger[config.level](`Task ${config.taskId} |`, ...messages);
      } else {
        this.logger[config.level](...messages);
      }
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
        task.result = result;

        task.finishedAt = new Date().getTime();
        this._updateTaskStatus(task, 'success');

        resolve(result);
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
  protected _cleanTask<TaskType extends Task | WaitedTask>(
    task: TaskType,
  ): TaskType {
    task.status = 'idle';
    task.queueId = undefined;
    task.result = undefined;
    task.error = undefined;
    task.runAt = undefined;
    task.finishedAt = undefined;

    return task;
  }

  /** @internal */
  protected _addTask<ReturnType>(
    task: Task<ReturnType> | WaitedTask<ReturnType>,
    withTaskClean: boolean = true,
  ) {
    if (withTaskClean) {
      this._cleanTask(task);
    }

    this._log(
      {
        level: 'info',
        taskId: task.taskId,
      },
      'Processing task:',
      task,
    );

    const _isWaitedTask = isWaitedTask(task);
    this._log(
      {
        level: 'info',
        taskId: task.taskId,
      },
      `Task ${task.taskId} is a ${
        _isWaitedTask ? 'waited task' : 'normal task'
      }`,
    );

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
    this._log(
      {
        level: 'info',
        taskId: task.taskId,
      },
      'Get available promise queue:',
      promiseQueue,
    );

    // If there is no available promise queue or we should stop the execution,
    // append the task to the waiting queue
    if (!promiseQueue || this._shouldStop(task)) {
      Promise.resolve().then(() => {
        // Directly modify the existing task instance to keep the task reference
        // (for the inherited class)
        (task as WaitedTask).resolve = _resolve;
        (task as WaitedTask).reject = _reject;
        (task as WaitedTask).promise = _promise;

        this._pushTaskToWaitingQueue(task);
      });
    }

    // If there is an available promise queue, append the task to it
    else {
      promiseQueue.length += 1;
      promiseQueue.taskIds.push(task.taskId);

      // Update the length and task ids for all the parent queues
      let currentParentQueue = promiseQueue.parentQueue;
      while (currentParentQueue) {
        currentParentQueue.length += 1;
        currentParentQueue.taskIds.push(task.taskId);

        currentParentQueue = currentParentQueue.parentQueue;
      }

      task.queueId = promiseQueue.queueId;

      const resolveTask = (
        resultType: 'result' | 'error',
        result: ReturnType | Error,
        resolve: Resolve<ReturnType> | Reject,
      ) => {
        promiseQueue.length -= 1;
        promiseQueue.taskIds.shift();

        // Update the length and task ids for all the parent queues
        let currentParentQueue = promiseQueue.parentQueue;
        let farestParentQueue = promiseQueue.parentQueue;
        while (currentParentQueue) {
          currentParentQueue.length -= 1;
          currentParentQueue.taskIds.shift();

          currentParentQueue = currentParentQueue.parentQueue;

          if (currentParentQueue) {
            farestParentQueue = currentParentQueue;
          }
        }

        resolve(result as any);

        this._log(
          {
            level: resultType === 'result' ? 'info' : 'error',
            taskId: task.taskId,
          },
          resultType === 'result'
            ? `Resolved task ${task.taskId} with result ${result}`
            : `Rejected task ${task.taskId} with error ${result}`,
        );

        this._log(
          { level: 'info' },
          'promiseQueue.taskIds',
          promiseQueue.taskIds,
        );

        // If the current queue has a parent queue with tasks assigned,
        // then this queue should stop and let the parent queue continue
        // execution
        //
        // Cases that the above conditions are met:
        // 1. Multiple queues are assigned to the parent queue due to
        // concurrency adjustment (this queue should stop)
        //
        // ----------------------------------------------------------------
        //
        // If the current queue has a parent queue without task assigned,
        // then this queue should continue
        //
        // Cases that the above conditions are met:
        // 1. Only this queue is assigned to the parent queue due to
        //    concurrency adjustment, where the parent queue also rely
        //    on this queue to continue execution (this queue should continue)
        if (farestParentQueue && farestParentQueue.taskIds.length > 0) {
          // TODO: Might need to clean up all deprecated queues to have good
          // states

          return;
        }

        // If stopped, directly return to skip the execution of next task
        if (this._shouldStop(task)) {
          return;
        }

        // Get and re-add the first task from the waiting queue after the
        // previous "Promise.resolve().then()" finishes appending tasks to
        // the waiting queue
        Promise.resolve().then(() => {
          const nextTask = this._getNextTask();

          if (nextTask) {
            this._log(
              {
                level: 'info',
                taskId: task.taskId,
              },
              `Picked the next task ${nextTask.taskId} to continue execution`,
            );

            this._addTask(nextTask);
          } else {
            this._log(
              {
                level: 'info',
                taskId: task.taskId,
              },
              `No more task to continue execution`,
            );
          }
        });
      };

      const runTask = () => {
        this._log(
          {
            level: 'info',
            taskId: task.taskId,
          },
          `Running task ${task.taskId}`,
        );

        return this._runTask(
          task,
          (result) => {
            resolveTask('result', result, _resolve);
          },
          (error) => {
            resolveTask('error', error, _reject);
          },
        );
      };

      // Keep running tasks no matter the previous task is resolved or rejected
      // NOTE: You do not need to change this for most cases
      promiseQueue.promise.then(runTask).catch(runTask);

      // Append the promise to the promise queue to serialize async task
      // executions
      // NOTE: You do not need to change this for most cases
      promiseQueue.promise = _promise;
    }

    // Return the result from the original callback function of the task
    // NOTE: You do not need to change this for most cases
    return _promise;
  }
}

export default TaskQueueCore;
