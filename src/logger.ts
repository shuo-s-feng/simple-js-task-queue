import { IfFunction } from './type';

export interface ILogger {
  info(...messages: Array<any>): void;
  warn(...messages: Array<any>): void;
  error(...messages: Array<any>): void;
}

// Extracting method names
export type LoggerMethodNames = {
  [K in keyof ILogger]: IfFunction<ILogger[K], K>;
}[keyof ILogger];

export class Logger implements ILogger {
  info(...messages: Array<any>) {
    console.info(...messages);
  }

  warn(...messages: Array<any>) {
    console.warn(...messages);
  }

  error(...messages: Array<any>) {
    console.error(...messages);
  }
}

export const logger = new Logger();
export default logger;
