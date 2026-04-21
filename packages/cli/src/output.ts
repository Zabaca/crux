let jsonMode = false;

export function setJsonMode(on: boolean) {
  jsonMode = on;
}

export function isJsonMode(): boolean {
  return jsonMode;
}

export function emit(payload: unknown, humanLine?: string): void {
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
