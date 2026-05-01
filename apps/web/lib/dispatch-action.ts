/**
 * Client helper: POST /api/action and parse the typed response.
 * Server is the source of truth; this is a thin wrapper that surfaces
 * structured error info to forms.
 */
export type ActionResponse =
  | { ok: true; revision: number; result: unknown }
  | {
      ok: false;
      code: "INVALID_PAYLOAD" | "ACTION_NOT_ALLOWED" | "TRANSITION_ERROR";
      message: string;
      allowed?: string[];
    };

export async function dispatchAction(kind: string, payload: unknown): Promise<ActionResponse> {
  try {
    const res = await fetch("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, payload }),
    });
    return (await res.json()) as ActionResponse;
  } catch (err) {
    return {
      ok: false,
      code: "TRANSITION_ERROR",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
