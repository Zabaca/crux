import { loadViewMeta } from "@crux/core/view-state";
import { isJsonMode } from "./output.js";

export function wsArg(explicit: string | undefined): string {
  if (explicit) return explicit;
  const id = loadViewMeta().context.workstreamId;
  if (!id)
    throw new Error(
      'no --workstream given and no workstream in view state; run: crux view send SELECT_WORKSTREAM --payload \'{"id":"WS-<slug>"}\'',
    );
  return id;
}

export function problemArg(explicit: string | undefined): string {
  if (explicit) return explicit;
  const id = loadViewMeta().context.problemId;
  if (!id)
    throw new Error(
      'no --problem given and no problem in view state; run: crux view send OPEN_PROBLEM --payload \'{"id":"PRB-<slug>"}\'',
    );
  return id;
}

export function hintCtx(ws?: string, problem?: string): void {
  if (isJsonMode()) return;
  const parts: string[] = [];
  if (ws) parts.push(`workstream=${ws}`);
  if (problem) parts.push(`problem=${problem}`);
  if (parts.length) process.stderr.write(`# context: ${parts.join(", ")}\n`);
}
