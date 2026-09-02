export type ErrorCode =
  | "ILLEGAL_TRANSITION"
  | "INVARIANT_VIOLATION"
  | "REFERENTIAL_MISMATCH"
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "VALIDATION_ERROR"
  | "CAPACITY_EXCEEDED";

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

/**
 * The free allowance on an unclaimed Principal is spent (ADR-0013).
 *
 * Carries the claim URL in `details` rather than only in the message, so the
 * agent that hit the wall can offer the fix without parsing prose.
 */
export class CapacityExceededError extends CruxError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("CAPACITY_EXCEEDED", message, details);
  }
}

export class ValidationError extends CruxError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("VALIDATION_ERROR", message, details);
  }
}
