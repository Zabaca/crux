let jsonMode = false;

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

export function emit(payload: unknown, humanLine?: string): void {
  if (captureWriter) {
    captureWriter(payload);
    return;
  }
  if (jsonMode || humanLine === undefined) {
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  } else {
    process.stdout.write(humanLine + "\n");
  }
}

export function emitError(payload: unknown, humanLine?: string): void {
  if (jsonMode) {
    process.stderr.write(JSON.stringify(payload, null, 2) + "\n");
  } else {
    process.stderr.write((humanLine ?? JSON.stringify(payload)) + "\n");
  }
}
