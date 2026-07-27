import { api } from "./api-client.js";
import { isJsonMode } from "./output.js";

type ViewPayload = { context: { workstreamId: string | null; problemId: string | null } };

/** The view-state context, read from the deployment's per-user view store. */
async function viewContext(): Promise<ViewPayload["context"]> {
  return (await api().get<ViewPayload>("/v1/view")).context;
}

export async function wsArg(): Promise<string> {
  const id = (await viewContext()).workstreamId;
  if (!id) throw new Error("no workstream selected — run `crux workstream select <slug>` first");
  return id;
}

export async function problemArg(explicit: string | undefined): Promise<string> {
  if (explicit) return explicit;
  const id = (await viewContext()).problemId;
  if (!id)
    throw new Error(
      'no --problem given and no problem in view state; run: crux view send OPEN_PROBLEM --payload \'{"id":"42"}\'',
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
