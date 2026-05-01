import { CruxError } from "@crux/core/transitions";
import { ActionNotAllowedError } from "@crux/core/actions";
import { ZodError } from "zod";
import { emitError } from "./output.js";

export const EXIT_CODES: Record<string, number> = {
  ILLEGAL_TRANSITION: 20,
  INVARIANT_VIOLATION: 21,
  REFERENTIAL_MISMATCH: 22,
  NOT_FOUND: 23,
  VALIDATION_ERROR: 24,
  ALREADY_EXISTS: 24,
  ACTION_NOT_ALLOWED: 25,
  USAGE: 2,
  UNKNOWN: 1,
};

export function handleError(err: unknown): never {
  if (err instanceof ActionNotAllowedError) {
    emitError(
      {
        error: {
          code: err.code,
          message: err.message,
          details: {
            state: err.state,
            attempted: err.attempted,
            allowedView: err.allowedView,
            allowedMutation: err.allowedMutation,
            globals: err.globals,
          },
        },
      },
      `[ACTION_NOT_ALLOWED] ${err.message}`,
    );
    process.exit(EXIT_CODES.ACTION_NOT_ALLOWED);
  }
  if (err instanceof ZodError) {
    const message = err.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    emitError(
      { error: { code: "VALIDATION_ERROR", message, details: { issues: err.issues } } },
      `[VALIDATION_ERROR] ${message}`,
    );
    process.exit(EXIT_CODES.VALIDATION_ERROR);
  }
  if (err instanceof CruxError) {
    emitError(
      { error: { code: err.code, message: err.message, details: err.details } },
      `[${err.code}] ${err.message}`,
    );
    process.exit(EXIT_CODES[err.code] ?? EXIT_CODES.UNKNOWN);
  }
  if (err instanceof Error) {
    emitError({ error: { code: "UNKNOWN", message: err.message } }, `error: ${err.message}`);
    process.exit(EXIT_CODES.UNKNOWN);
  }
  emitError({ error: { code: "UNKNOWN", message: String(err) } }, `error: ${String(err)}`);
  process.exit(EXIT_CODES.UNKNOWN);
}
