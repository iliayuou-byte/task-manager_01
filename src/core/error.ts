/**
 * Custom error class for operational errors.
 * Distinguishes between operational errors (expected, like 404, 401) and programming errors.
 * Operational errors are safe to send to clients; programming errors get generic 500 response.
 */
export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class TaskRevisionConflictError extends Error {
  constructor() {
    super('Tasks changed on GitHub. Reload and repeat your action.');
    this.name = 'TaskRevisionConflictError';
  }
}
