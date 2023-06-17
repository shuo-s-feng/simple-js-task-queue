const RANDOM_BASE = 100000000;

/**
 * Get a random task id
 */
export const getTaskId = () => Math.floor(Math.random() * RANDOM_BASE);
