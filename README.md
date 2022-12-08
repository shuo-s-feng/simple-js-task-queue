<h1 align="center">simple-js-task-queue</h1>

<div align="center">
  A simple javascript/typesciprt tasks queue that supports concurrency control, designed by
  <a href="https://linkedin.com/in/shuo-feng-1030/">Shuo Feng</a>
</div>

<br />

## Table of Contents

- [Introduction](#introduction)
- [Installation](#installation)
- [Example](#example)
- [License](#license)

## Introduction

This lightweight, error-tolerant, no-dependency library helps easily manage concurrency in javascript environments by a task queue. It supports both javascript and typescript, synchronous and asynchronous tasks concurrency control, task details retrieval, and subcription to the task status updates.

## Installation

```
npm i simple-js-task-queue
```

## Example

```js
const { TaskQueue } = require("simple-js-task-queue");

// Initialize a queue with maximum concurrency 2, returning error if tasks fail, and memorizing task details
const queue = new TaskQueue({
  concurrency: 2,
  returnError: true,
  memorizeTasks: true,
});

// Helper function to generate a task, which returns "Result {id}" after {wait} seconds
const generateTask = (id, wait) => {
  return async () => {
    await new Promise((res) => setTimeout(res, wait * 1000));
    return `Result ${id}`;
  };
};

// Helper function to handle the result of the task
const handleTaskResult = (taskId, result) => {
  console.log(
    `After ${
      (new Date().getTime() - start) / 1000
    } seconds, the result of task ${taskId} is ${result}`
  );
};

// Helper function to handle the task status changes
const handleTaskStatusChange = (status, task) => {
  console.log(
    `After ${
      (new Date().getTime() - start) / 1000
    } seconds, the status of task 3 changed to ${status} with result ${
      task.result
    }`
  );
};

// Create tasks
const tasks = new Array(4)
  .fill(null)
  .map((_, index) => generateTask(index, index));

const start = new Date().getTime();

// Run task 1 with ID 1, and log the result
queue.addTask(tasks[1], 1).then((result) => handleTaskResult(1, result));

// Run task 2 with ID 2, and log the result
queue.addTask(tasks[2], 2).then((result) => handleTaskResult(2, result));

// Run task 3 with ID 3, subscribe to the task status updates, and log the result
queue
  .addTask(tasks[3], 3, handleTaskStatusChange)
  .then((result) => handleTaskResult(3, result));

// Log all task details after 5 seconds
setTimeout(() => {
  console.log(
    "All task details:\n",
    queue.getAllTasks().map((task) => ({
      result: task.result,
      status: task.status,
      createdAt: new Date(task.createdAt).toLocaleString(),
      runAt: new Date(task.runAt).toLocaleString(),
      finishedAt: new Date(task.finishedAt).toLocaleString(),
    }))
  );
}, 5000);

// logs
//
// After 1.001 seconds, the result of task 1 is Result 1
//
// After 1.002 seconds, the status of task 3 changed to running with result undefined
//
// After 2.002 seconds, the result of task 2 is Result 2
//
// After 4.003 seconds, the status of task 3 changed to success with result Result 3
//
// After 4.003 seconds, the result of task 3 is Result 3
//
// All task details:
//
// [ { result: 'Result 3',
//     status: 'success',
//     createdAt: '12/3/2022, 2:33:30 PM',
//     runAt: '12/3/2022, 2:33:31 PM',
//     finishedAt: '12/3/2022, 2:33:34 PM' },
//   { result: 'Result 2',
//     status: 'success',
//     createdAt: '12/3/2022, 2:33:30 PM',
//     runAt: '12/3/2022, 2:33:30 PM',
//     finishedAt: '12/3/2022, 2:33:32 PM' },
//   { result: 'Result 1',
//     status: 'success',
//     createdAt: '12/3/2022, 2:33:30 PM',
//     runAt: '12/3/2022, 2:33:30 PM',
//     finishedAt: '12/3/2022, 2:33:31 PM' } ]
```

## License

This library is [MIT licensed](./LICENSE.md).
