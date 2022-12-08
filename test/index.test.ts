import { TaskQueue } from '../src';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

const TASK_COUNT = 20;
const BASE_TIME_FACTOR = 50;

const delay = (wait: number) => new Promise((res) => setTimeout(res, wait));

// Helper function to generate a task, which returns "Result {id}" after {wait * BASE_TIME_FACTOR} ms
const generateTask = (id: number, wait: number) => {
	return async () => {
		await delay(wait * BASE_TIME_FACTOR);
		return `Result ${id}`;
	};
};

// Create tasks
const tasks = new Array(TASK_COUNT)
	.fill(null)
	.map((_, index) => generateTask(index, index));

// Helper function to verify the result of the task
const verifyResult =
	(result: any, executeTimeUnit: number, startTime: number) =>
	(realResult: any) => {
		const realFinishTime = Math.round(
			(new Date().getTime() - startTime) / BASE_TIME_FACTOR,
		);

		expect(realFinishTime).toBe(executeTimeUnit);
		expect(realResult).toStrictEqual(result);
	};

type SimplifiedTask = {
	taskId: string | number;
	status: string;
	result: any;
};

// Helper function to verify task information
const verifyTasks = (
	realTasks: Array<SimplifiedTask> | SimplifiedTask,
	tasks: Array<SimplifiedTask> | SimplifiedTask,
) => {
	if (Array.isArray(realTasks) && Array.isArray(tasks)) {
		expect(realTasks.length).toBe(tasks.length);

		for (let task of tasks) {
			const realTask = realTasks.find(
				(realTask) => realTask.taskId === task.taskId,
			);

			expect(realTask?.status).toBe(task.status);
			expect(realTask?.result).toBe(task.result);
		}
	} else if (!Array.isArray(realTasks) && !Array.isArray(tasks)) {
		expect(realTasks?.status).toBe(tasks.status);
		expect(realTasks?.result).toBe(tasks.result);
		expect(realTasks?.result).toBe(tasks.result);
	} else {
		throw Error('Either realTasks or tasks is an array');
	}
};

let promises: Array<Promise<any>> = [];

describe('simple-js-task-queue', () => {
	beforeEach(() => {
		promises = [];
	});

	afterEach(async () => {
		// Wait for all promises to finish before the next test case
		await Promise.all(promises);
	});

	it('controls concurrency for tasks #1', async () => {
		const queue = new TaskQueue({
			concurrency: 2,
		});

		const start = new Date().getTime();

		// Task 1 goes to queue 1
		promises.push(
			queue.addTask(tasks[1]).then(verifyResult('Result 1', 1, start)),
		);

		// Task 2 goes to queue 2
		promises.push(
			queue.addTask(tasks[2]).then(verifyResult('Result 2', 2, start)),
		);

		// Task 3 goes to queue 1
		promises.push(
			queue.addTask(tasks[3]).then(verifyResult('Result 3', 4, start)),
		);

		// Task 4 goes to queue 2
		promises.push(
			queue.addTask(tasks[4]).then(verifyResult('Result 4', 6, start)),
		);
	});

	it('controls concurrency for tasks #2', async () => {
		const queue = new TaskQueue({
			concurrency: 2,
		});

		const start = new Date().getTime();

		// Total execution time will be 2 + 4 = 6
		promises.push(
			queue
				.addTasks([
					{
						callback: tasks[1],
					},
					{
						callback: tasks[2],
					},
					{
						callback: tasks[3],
					},
					{
						callback: tasks[4],
					},
				])
				.then(
					verifyResult(
						['Result 1', 'Result 2', 'Result 3', 'Result 4'],
						6,
						start,
					),
				),
		);
	});

	it('returns error if specified', async () => {
		const queue = new TaskQueue({
			concurrency: 2,
			returnError: true,
		});

		promises.push(
			queue
				.addTask(() => {
					const trueCondition = 1;
					if (trueCondition) {
						throw Error('Test');
					}

					return 'Result';
				})
				.then((result) => {
					expect((result as unknown as Error).message).toBe('Test');
				}),
		);
	});

	it('supports the subscription to the task status updates', async () => {
		const queue = new TaskQueue({
			concurrency: 2,
		});

		let times1 = 0;

		promises.push(
			queue.addTask(tasks[1], 1, (status, task) => {
				times1 += 1;

				if (times1 === 1) {
					expect(status).toBe('running');
					expect(task.result).toBe(undefined);
				} else if (times1 > 1) {
					expect(status).toBe('success');
					expect(task.result).toBe('Result 1');
				}
			}),
		);

		let times2 = 0;

		promises.push(
			queue.addTask(tasks[1], (status, task) => {
				times2 += 1;

				if (times2 === 1) {
					expect(status).toBe('running');
					expect(task.result).toBe(undefined);
				} else if (times2 > 1) {
					expect(status).toBe('success');
					expect(task.result).toBe('Result 1');
				}
			}),
		);
	});

	it('supports task information retrieval #1', async () => {
		const queue = new TaskQueue({
			concurrency: 2,
			memorizeTasks: true,
		});

		promises.push(
			queue.addTask(tasks[1], 1).then(() =>
				verifyTasks(queue.getTask(1) as SimplifiedTask, {
					taskId: 1,
					status: 'success',
					result: 'Result 1',
				}),
			),
		);

		promises.push(
			queue.addTask(tasks[2], 2).then(() =>
				verifyTasks(queue.getTask(2) as SimplifiedTask, {
					taskId: 2,
					status: 'success',
					result: 'Result 2',
				}),
			),
		);

		promises.push(
			queue.addTask(tasks[3], 3).then(() =>
				verifyTasks(queue.getTask(3) as SimplifiedTask, {
					taskId: 3,
					status: 'success',
					result: 'Result 3',
				}),
			),
		);

		promises.push(
			queue.addTask(tasks[4], 4).then(() =>
				verifyTasks(queue.getTask(4) as SimplifiedTask, {
					taskId: 4,
					status: 'success',
					result: 'Result 4',
				}),
			),
		);
	});

	it('supports task information retrieval #2', async () => {
		const queue = new TaskQueue({
			concurrency: 2,
			memorizeTasks: true,
		});

		promises.push(
			queue.addTask(tasks[1], 1).then(() =>
				verifyTasks(queue.getAllTasks() as Array<SimplifiedTask>, [
					{
						taskId: 1,
						status: 'success',
						result: 'Result 1',
					},
					{
						taskId: 2,
						status: 'running',
						result: undefined,
					},
					{
						taskId: 3,
						status: 'idle',
						result: undefined,
					},
					{
						taskId: 4,
						status: 'idle',
						result: undefined,
					},
				]),
			),
		);

		promises.push(
			queue.addTask(tasks[2], 2).then(() =>
				verifyTasks(queue.getAllTasks() as Array<SimplifiedTask>, [
					{
						taskId: 1,
						status: 'success',
						result: 'Result 1',
					},
					{
						taskId: 2,
						status: 'success',
						result: 'Result 2',
					},
					{
						taskId: 3,
						status: 'running',
						result: undefined,
					},
					{
						taskId: 4,
						status: 'idle',
						result: undefined,
					},
				]),
			),
		);

		promises.push(
			queue.addTask(tasks[3], 3).then(() =>
				verifyTasks(queue.getAllTasks() as Array<SimplifiedTask>, [
					{
						taskId: 1,
						status: 'success',
						result: 'Result 1',
					},
					{
						taskId: 2,
						status: 'success',
						result: 'Result 2',
					},
					{
						taskId: 3,
						status: 'success',
						result: 'Result 3',
					},
					{
						taskId: 4,
						status: 'running',
						result: undefined,
					},
				]),
			),
		);

		promises.push(
			queue.addTask(tasks[4], 4).then(() =>
				verifyTasks(queue.getAllTasks() as Array<SimplifiedTask>, [
					{
						taskId: 1,
						status: 'success',
						result: 'Result 1',
					},
					{
						taskId: 2,
						status: 'success',
						result: 'Result 2',
					},
					{
						taskId: 3,
						status: 'success',
						result: 'Result 3',
					},
					{
						taskId: 4,
						status: 'success',
						result: 'Result 4',
					},
				]),
			),
		);
	});

	it('supports task information retrieval #3', async () => {
		const queue = new TaskQueue({
			concurrency: 2,
			memorizeTasks: true,
		});

		promises.push(
			queue.addTask(tasks[1], 1).then(() =>
				verifyTasks(queue.getAllTasks('idle') as Array<SimplifiedTask>, [
					{
						taskId: 3,
						status: 'idle',
						result: undefined,
					},
					{
						taskId: 4,
						status: 'idle',
						result: undefined,
					},
				]),
			),
		);

		promises.push(
			queue.addTask(tasks[2], 2).then(() =>
				verifyTasks(
					queue.getAllTasks(['idle', 'success']) as Array<SimplifiedTask>,
					[
						{
							taskId: 1,
							status: 'success',
							result: 'Result 1',
						},
						{
							taskId: 2,
							status: 'success',
							result: 'Result 2',
						},
						{
							taskId: 4,
							status: 'idle',
							result: undefined,
						},
					],
				),
			),
		);

		promises.push(
			queue.addTask(tasks[3], 3).then(() =>
				verifyTasks(
					queue.getAllTasks(['success', 'running']) as Array<SimplifiedTask>,
					[
						{
							taskId: 1,
							status: 'success',
							result: 'Result 1',
						},
						{
							taskId: 2,
							status: 'success',
							result: 'Result 2',
						},
						{
							taskId: 3,
							status: 'success',
							result: 'Result 3',
						},
						{
							taskId: 4,
							status: 'running',
							result: undefined,
						},
					],
				),
			),
		);

		promises.push(
			queue.addTask(tasks[4], 4).then(() =>
				verifyTasks(queue.getAllTasks(['success']) as Array<SimplifiedTask>, [
					{
						taskId: 1,
						status: 'success',
						result: 'Result 1',
					},
					{
						taskId: 2,
						status: 'success',
						result: 'Result 2',
					},
					{
						taskId: 3,
						status: 'success',
						result: 'Result 3',
					},
					{
						taskId: 4,
						status: 'success',
						result: 'Result 4',
					},
				]),
			),
		);
	});

	it('throws errors', async () => {
		let queue: TaskQueue;

		try {
			queue = new TaskQueue({
				concurrency: 0,
			});
		} catch (error) {
			expect(error.message).toBe('Invalid concurrency 0');
		}

		queue = new TaskQueue({
			concurrency: 2,
		});
		try {
			queue.getTask(1);
		} catch (error) {
			expect(error.message).toBe(
				'Memorizing task details is not enabled. Please update the memorizeTasks configuration when initializing the queue instance',
			);
		}
		try {
			queue.getAllTasks();
		} catch (error) {
			expect(error.message).toBe(
				'Memorizing task details is not enabled. Please update the memorizeTasks configuration when initializing the queue instance',
			);
		}
		try {
			queue.clearTask(1);
		} catch (error) {
			expect(error.message).toBe(
				'Memorizing task details is not enabled. Please update the memorizeTasks configuration when initializing the queue instance',
			);
		}
		try {
			queue.clearAllTasks();
		} catch (error) {
			expect(error.message).toBe(
				'Memorizing task details is not enabled. Please update the memorizeTasks configuration when initializing the queue instance',
			);
		}

		try {
			queue = new TaskQueue({
				concurrency: 1,
			});

			await queue.addTask(tasks[1], 1);
			await queue.addTask(tasks[2], 1);
		} catch (error) {
			expect(error.message).toBe('Task 1 is already triggered');
		}
	});
});
