'use strict';

/**
 * Base Application Error class for all operational domain errors.
 */
class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 400 Bad Request: Input validation failures, invalid query parameters, or illegal state jumps.
 */
class BadRequestError extends AppError {
  constructor(message = 'Bad Request') {
    super(message, 400);
  }
}

/**
 * 400 Validation Error: Specific alias for payload validation failures.
 */
class ValidationError extends BadRequestError {
  constructor(message = 'Validation Error') {
    super(message);
  }
}

/**
 * 401 Unauthorized: Missing, invalid, or expired credentials/tokens.
 */
class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401);
  }
}

/**
 * 403 Forbidden: Authenticated user lacks role permissions or resource ownership.
 */
class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403);
  }
}

/**
 * 404 Not Found: Requested resource does not exist.
 */
class NotFoundError extends AppError {
  constructor(message = 'Resource Not Found') {
    super(message, 404);
  }
}

/**
 * 409 Conflict: Unique constraint duplicate (username/email) or concurrency race on incident claiming.
 */
class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super(message, 409);
  }
}

module.exports = {
  AppError,
  BadRequestError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError
};
