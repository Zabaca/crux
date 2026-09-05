export type ErrorCode =
  | "ILLEGAL_TRANSITION"
  | "INVARIANT_VIOLATION"
  | "REFERENTIAL_MISMATCH"
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "VALIDATION_ERROR"
  | "CAPACITY_EXCEEDED"
  | "UNKNOWN_KIND";

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

/**
 * The deployment does not recognise the `kind` it was asked for (ADR-0018).
 *
 * Named for the fact rather than the cause: both entry points are open HTTP, so
 * a hand-rolled client with a typo would be told its deployment is old and sent
 * to the wrong place. The *message* names the likely cause — a client ahead of
 * the deployment — because that is what a `crux` command hitting this is, and
 * because re-checking arguments is the repair it would otherwise attempt.
 *
 * The version travels beside it in `details`, added by the deployment: core
 * must not name a runtime or read the Worker's package (ADR-0003).
 */
export class UnknownKindError extends CruxError {
  constructor(kind: string) {
    super(
      "UNKNOWN_KIND",
      `this deployment does not recognise the kind "${kind}". That usually means the client is ahead of the deployment, so re-running with different arguments will not help.`,
      { kind },
    );
  }
}

export class ValidationError extends CruxError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("VALIDATION_ERROR", message, details);
  }
}
