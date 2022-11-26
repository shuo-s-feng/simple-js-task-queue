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
npm i --save simple-js-task-queue
```

## Example

```js
const { TaskQueue } = require("simple-js-task-queue");

// initialize a queue with maximum concurrency 2 and returning error if tasks fail
const queue = new TaskQueue({
  concurrency: 2,
  returnError: true,
});

const delay = (wait) => new Promise((res) => setTimeout(res, wait));

// helper function to generate a task, which returns "Result {id}" after {wait} seconds
const generateTask = (id, wait) => {
  return async () => {
    await delay(wait * 1000);
    return `Result ${id}`;
  };
};

// create tasks
const tasks = new Array(4)
  .fill(null)
  .map((_, index) => generateTask(index, index));

const start = new Date().getTime();

// run task 1 and log the result
queue
  .addTask(tasks[1])
  .then((data) =>
    console.log(
      `After ${
        (new Date().getTime() - start) / 1000
      } seconds, the result of task 1 is ${data}`
    )
  );

// run task 2 and log the result
queue
  .addTask(tasks[2])
  .then((data) =>
    console.log(
      `After ${
        (new Date().getTime() - start) / 1000
      } seconds, the result of task 2 is ${data}`
    )
  );

// run task 3, subscribe to the task status updates, and log the result
queue
  .addTask(tasks[3], (status) => {
    console.log(
      `After ${
        (new Date().getTime() - start) / 1000
      } seconds, the status of task 3 changed to ${status}`
    );
  })
  .then((data) =>
    console.log(
      `After ${
        (new Date().getTime() - start) / 1000
      } seconds, the result of task 3 is ${data}`
    )
  );

// logs
//
// After 1.002 seconds, the result of task 1 is Result 1
// After 1.003 seconds, the status of task 3 changed to running
// After 2.002 seconds, the result of task 2 is Result 2
// After 4.005 seconds, the status of task 3 changed to success
// After 4.005 seconds, the result of task 3 is Result 3
```

## License

This library is [MIT licensed](./LICENSE.md).
