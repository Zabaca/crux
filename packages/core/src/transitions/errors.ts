export type ErrorCode =
  | "ILLEGAL_TRANSITION"
  | "INVARIANT_VIOLATION"
  | "REFERENTIAL_MISMATCH"
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "VALIDATION_ERROR";

export class CruxError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;
  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
  }
}

export class TransitionError extends CruxError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("ILLEGAL_TRANSITION", message, details);
  }
}

export class InvariantError extends CruxError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("INVARIANT_VIOLATION", message, details);
  }
}

export class ReferentialError extends CruxError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("REFERENTIAL_MISMATCH", message, details);
  }
}

export class NotFoundError extends CruxError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("NOT_FOUND", message, details);
  }
}

export class ValidationError extends CruxError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("VALIDATION_ERROR", message, details);
  }
}
