const RANDOM_BASE = 100000000;

let currentTaskId: number = 0;

/**
 * Get a random or incremental task ID
 * @param incremental Toggle to use incremental task ID
 */
export const getTaskId = (incremental: boolean = true) =>
  incremental ? currentTaskId++ : Math.floor(Math.random() * RANDOM_BASE);
