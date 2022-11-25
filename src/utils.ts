import { WaitedTask } from "./types";

const RANDOM_BASE = 100000000;

export const getRandomTaskId = () => Math.random() * RANDOM_BASE;

export const isWaitedTask = (obj: any): obj is WaitedTask => {
  if (obj.resolve && obj.promise) {
    return true;
  }
  return false;
};
