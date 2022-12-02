import { TaskQueue } from "../src";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

const TASK_COUNT = 20;
const BASE_TIME_FACTOR = 50;

const delay = (wait: number) => new Promise((res) => setTimeout(res, wait));

// helper function to generate a task, which returns "Result {id}" after {wait * BASE_TIME_FACTOR} ms
const generateTask = (id: number, wait: number) => {
  return async () => {
    await delay(wait * BASE_TIME_FACTOR);
    return `Result ${id}`;
  };
};

// create tasks
const tasks = new Array(TASK_COUNT)
  .fill(null)
  .map((_, index) => generateTask(index, index));

// helper function to verify the result of the task
const verifyResult =
  (result: any, executeTimeUnit: number, startTime: number) =>
  (realResult: any) => {
    const realFinishTime = Math.round(
      (new Date().getTime() - startTime) / BASE_TIME_FACTOR
    );

    expect(realFinishTime).toBe(executeTimeUnit);
    expect(realResult).toStrictEqual(result);
  };

// helper function to verify task information
const verifyTasks = (
  realTasks: Array<{
    taskId: string | number;
    status: string;
    result: any;
  }>,
  tasks: Array<{
    taskId: string | number;
    status: string;
    result: any;
  }>
) => {
  expect(realTasks.length).toBe(tasks.length);

  for (let task of tasks) {
    const realTask = realTasks.find(
      (realTask) => realTask.taskId === task.taskId
    );

    expect(realTask?.status).toBe(task.status);
    expect(realTask?.result).toBe(task.result);
  }
};

let promises: Array<Promise<any>> = [];

describe("simple-js-task-queue", () => {
  beforeEach(() => {
    promises = [];
  });

  afterEach(async () => {
    // wait for all promises to finish before the next test case
    await Promise.all(promises);
  });

  it("should control concurrency for tasks #1", async () => {
    const queue = new TaskQueue({
      concurrency: 2,
    });

    const start = new Date().getTime();

    // Task 1 goes to queue 1
    promises.push(
      queue.addTask(tasks[1]).then(verifyResult("Result 1", 1, start))
    );

    // Task 2 goes to queue 2
    promises.push(
      queue.addTask(tasks[2]).then(verifyResult("Result 2", 2, start))
    );

    // Task 3 goes to queue 1
    promises.push(
      queue.addTask(tasks[3]).then(verifyResult("Result 3", 4, start))
    );

    // Task 4 goes to queue 2
    promises.push(
      queue.addTask(tasks[4]).then(verifyResult("Result 4", 6, start))
    );
  });

  it("should control concurrency for tasks #2", async () => {
    const queue = new TaskQueue({
      concurrency: 2,
    });

    const start = new Date().getTime();

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
            ["Result 1", "Result 2", "Result 3", "Result 4"],
            6,
            start
          )
        )
    );
  });

  it("should return error if specified", async () => {
    const queue = new TaskQueue({
      concurrency: 2,
      returnError: true,
    });

    promises.push(
      queue
        .addTask(() => {
          const trueCondition = 1;
          if (trueCondition) {
            throw Error("Test");
          }

          return "Result";
        })
        .then((result) => {
          expect((result as unknown as Error).message).toBe("Test");
        })
    );
  });

  it("should support the subscription to the task status updates", async () => {
    const queue = new TaskQueue({
      concurrency: 2,
    });

    let times = 0;

    promises.push(
      queue.addTask(tasks[1], 1, (status, task) => {
        times += 1;

        if (times === 1) {
          expect(status).toBe("running");
          expect(task.taskId).toBe(1);
        } else if (times > 1) {
          expect(status).toBe("success");
          expect(task.taskId).toBe(1);
        }
      })
    );
  });

  it("should support task information retrieval", async () => {
    const queue = new TaskQueue({
      concurrency: 2,
      memorizeTasks: true,
    });

    // Task 1 goes to queue 1
    promises.push(
      queue.addTask(tasks[1], 1).then(() =>
        verifyTasks(queue.getAllTasks() as any[], [
          {
            taskId: 1,
            status: "success",
            result: "Result 1",
          },
          {
            taskId: 2,
            status: "running",
            result: undefined,
          },
          {
            taskId: 3,
            status: "idle",
            result: undefined,
          },
          {
            taskId: 4,
            status: "idle",
            result: undefined,
          },
        ])
      )
    );

    // Task 2 goes to queue 2
    promises.push(
      queue.addTask(tasks[2], 2).then(() =>
        verifyTasks(queue.getAllTasks() as any[], [
          {
            taskId: 1,
            status: "success",
            result: "Result 1",
          },
          {
            taskId: 2,
            status: "success",
            result: "Result 2",
          },
          {
            taskId: 3,
            status: "running",
            result: undefined,
          },
          {
            taskId: 4,
            status: "idle",
            result: undefined,
          },
        ])
      )
    );

    // Task 3 goes to queue 1
    promises.push(
      queue.addTask(tasks[3], 3).then(() =>
        verifyTasks(queue.getAllTasks() as any[], [
          {
            taskId: 1,
            status: "success",
            result: "Result 1",
          },
          {
            taskId: 2,
            status: "success",
            result: "Result 2",
          },
          {
            taskId: 3,
            status: "success",
            result: "Result 3",
          },
          {
            taskId: 4,
            status: "running",
            result: undefined,
          },
        ])
      )
    );

    // Task 4 goes to queue 2
    promises.push(
      queue.addTask(tasks[4], 4).then(() =>
        verifyTasks(queue.getAllTasks() as any[], [
          {
            taskId: 1,
            status: "success",
            result: "Result 1",
          },
          {
            taskId: 2,
            status: "success",
            result: "Result 2",
          },
          {
            taskId: 3,
            status: "success",
            result: "Result 3",
          },
          {
            taskId: 4,
            status: "success",
            result: "Result 4",
          },
        ])
      )
    );
  });
});
