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

This lightweight, error-tolerant, no-dependency library provides a sophisticated taks queue management system designed for TypeScript and JavaScript applications, providing advanced functionalities for managing, executing, and monitoring synchronous and asynchronous tasks.

## Features

- **Advanced Task Management**: Efficiently manage tasks with customizable priorities and statuses.
- **Concurrency Control**: Fine-tune the execution of tasks with dynamic concurrency settings.
- **Error Handling**: Comprehensive options for error management including retry mechanisms.
- **Integrated Logging**: Leverage built-in logging for easy monitoring and debugging.
- **Flexible Task Prioritization**: Utilize various prioritization strategies to control task execution order.

## Installation

```bash
npm install simple-js-task-queue
```

Or

```bash
yarn add simple-js-task-queue
```

## Demo

Check out [this codesanbox project](https://codesandbox.io/s/react-typescript-forked-knts9f)!

## Usage

Below is a simple example demonstrating how to use the `TaskQueue` to add and execute a task:

```typescript
import { TaskQueue } from 'simple-js-task-queue';

const queue = new TaskQueue();

queue
  .addTask(async () => {
    console.log('Performing a task...');
    // Task implementation
  })
  .then((result) => {
    console.log('Task completed.');
  });
```

## API Reference

### TaskQueue Class

The `TaskQueue` class is at the core of the library, offering a rich set of methods to manage tasks:

#### Constructor

- **`constructor(props?: TaskQueueProps)`**: Initializes a new instance of the task queue with optional configurations.

#### Methods

- **`addTask(callback, onStatusUpdate?, priority?)`**: Adds a new task to the queue.
- **`addPrioritizedTask(callback, onStatusUpdate?)`**: Adds a high-priority task to the queue.
- **`addTasks(tasks)`**: Bulk addition of tasks.
- **`adjustConcurrency(newConcurrency)`**: Adjusts the number of tasks that can run concurrently, effective instantly.
- **`start()`**: Starts or resumes task execution.
- **`stop()`**: Pauses task execution.
- **`retry()`**: Retries failed tasks.
- **`subscribeTaskStatusChange(onTaskStatusUpdate)`**: Subscribes to task status updates.
- **`unsubscribeTaskStatusChange(onTaskStatusUpdate)`**: Unsubscribes from task status updates.
- **`getTaskDetails(taskId)`**: Fetches details of a specific task.
- **`getAllTasksDetails(status?)`**: Retrieves details of all tasks, optionally filtered by status.
- **`clearTaskDetails(taskId)`**: Clears details of a specific task.
- **`clearAllTasksDetails()`**: Removes details of all tasks from memory.
- **`clearFailedRetryableTasks()`**: Clears the list of failed tasks marked for retry.
- **`clearWaitedTasks()`**: Removes all tasks waiting to be executed.
- **`removeFailedRetryableTask(taskIdOrTask)`**: Removes a specific task from the retry list.
- **`removeWaitedTask(taskId)`**: Removes a specific task from the waiting list.

For more detailed information on each method, including parameter types and return values, please refer to the TypeDoc generated documentation in the `docs` folder.

## License

This library is [MIT licensed](./LICENSE.md).
