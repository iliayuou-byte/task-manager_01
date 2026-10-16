import { recordUsageError } from '../services/usageStats.js';

enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

const LOG_LEVEL = (() => {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();
  switch (envLevel) {
    case 'debug':
      return LogLevel.DEBUG;
    case 'warn':
      return LogLevel.WARN;
    case 'error':
      return LogLevel.ERROR;
    default:
      return LogLevel.INFO;
  }
})();

class Logger {
  constructor(private level: LogLevel) {}

  private getTimestamp(): string {
    return new Date().toISOString();
  }

  private format(level: string, message: string): string {
    return `[${this.getTimestamp()}] [${level}] ${message}`;
  }

  errorWithContext(params: LogParams, ...args: unknown[]): void {
    recordUsageError();
    if (this.level >= LogLevel.ERROR) {
      console.error(this.format('ERROR', formatLogMessage(params)), ...args);
    }
  }

  warnWithContext(params: LogParams, ...args: unknown[]): void {
    if (params.op && ['VOICE', 'INPUT_RETRY', 'ASSISTANT'].includes(params.op))
      recordUsageError();
    if (this.level >= LogLevel.WARN) {
      console.warn(this.format('WARN', formatLogMessage(params)), ...args);
    }
  }

  infoWithContext(params: LogParams, ...args: unknown[]): void {
    if (this.level >= LogLevel.INFO) {
      console.info(this.format('INFO', formatLogMessage(params)), ...args);
    }
  }

  debugWithContext(params: LogParams, ...args: unknown[]): void {
    if (this.level >= LogLevel.DEBUG) {
      console.debug(this.format('DEBUG', formatLogMessage(params)), ...args);
    }
  }
}

type LogParams = {
  userId?: number | string;
  op?: string;
  error?: unknown;
  message?: string;
};

/** Commands are lowercase (e.g. "add", "list"); ops are UPPER_SNAKE_CASE (e.g. "AI_API") */
const isCommand = (op: string): boolean => op === op.toLowerCase();

/**
 * Formats log messages with structured context
 * Used internally by Logger.xxxWithContext methods and can be used standalone
 */
const formatLogMessage = ({
  userId,
  op,
  error,
  message,
}: LogParams): string => {
  const parts: string[] = [];

  if (userId) {
    parts.push(`[user: ${userId}]`);
  }

  if (op) {
    parts.push(isCommand(op) ? `/${op}` : `[${op}]`);
  }

  if (message) {
    parts.push(message);
  }

  if (error !== undefined) {
    const errMsg =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : JSON.stringify(error);
    parts.push(`error: ${errMsg}`);
  }

  return parts.join(' ');
};

const logger = new Logger(LOG_LEVEL);
export default logger;
