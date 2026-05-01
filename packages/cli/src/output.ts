let jsonMode = true;

export function setJsonMode(on: boolean) {
  jsonMode = on;
}

export function isJsonMode(): boolean {
  return jsonMode;
}

/**
 * When set, `emit()` calls this function instead of writing to stdout.
 * Pass `null` to restore default behaviour. Used by tests to capture output.
 */
let captureWriter: ((payload: unknown) => void) | null = null;

export function setCaptureWriter(fn: ((payload: unknown) => void) | null): void {
  captureWriter = fn;
}

/** Minimal interface satisfied by any Zod schema (avoids importing zod into cli). */
export interface OutputSchema {
  parse(data: unknown): unknown;
}

/**
 * emit(payload)                         — write payload (JSON or human)
 * emit(payload, humanLine)              — write payload JSON or humanLine (back-compat)
 * emit(payload, schema)                 — validate then write payload
 * emit(payload, schema, humanLine)      — validate then write payload JSON or humanLine
 */
export function emit(
  payload: unknown,
  schemaOrHuman?: OutputSchema | string,
  humanLine?: string,
): void {
  let schema: OutputSchema | undefined;
  let human: string | undefined;
  if (typeof schemaOrHuman === "string") {
    human = schemaOrHuman;
  } else {
    schema = schemaOrHuman;
    human = humanLine;
  }
  if (schema) {
    schema.parse(payload); // throws ZodError on shape violation
  }
  if (captureWriter) {
    captureWriter(payload);
    return;
  }
  if (jsonMode || human === undefined) {
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  } else {
    process.stdout.write(human + "\n");
  }
}

export function emitError(payload: unknown, humanLine?: string): void {
  if (jsonMode) {
    process.stderr.write(JSON.stringify(payload, null, 2) + "\n");
  } else {
    process.stderr.write((humanLine ?? JSON.stringify(payload)) + "\n");
  }
}
