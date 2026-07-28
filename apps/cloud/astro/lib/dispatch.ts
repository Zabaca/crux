/**
 * The islands' only write path.
 *
 * Everything the browser changes about the corpus goes through `POST /v1/dispatch`
 * — the same endpoint the CLI uses, running the same `dispatch()` — so there is
 * no browser-only write route where an invariant could be skipped. The session
 * cookie rides along automatically; the server requires it to be same-origin.
 */

/** The `{error:{code,message,details}}` envelope, as the islands need it. */
export type DispatchFailure = {
  ok: false;
  code: string;
  message: string;
  /** Present on ACTION_NOT_ALLOWED: what the current view state does permit. */
  allowed?: string[];
};

export type DispatchResult = { ok: true; result: unknown } | DispatchFailure;

export async function dispatchAction(kind: string, payload: unknown): Promise<DispatchResult> {
  let res: Response;
  try {
    res = await fetch("/v1/dispatch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, payload }),
    });
  } catch (err) {
    // A dropped connection is still a failed write, and saying so beats a card
    // that silently slid back into place.
    return {
      ok: false,
      code: "NETWORK",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  if (res.ok) return { ok: true, result: await res.json() };

  const body = (await res.json().catch(() => null)) as {
    error?: { code?: string; message?: string; details?: { allowedMutation?: string[] } };
  } | null;
  const error = body?.error;
  return {
    ok: false,
    code: error?.code ?? "UNKNOWN",
    message: error?.message ?? `${res.status} ${res.statusText}`,
    ...(error?.details?.allowedMutation ? { allowed: error.details.allowedMutation } : {}),
  };
}

/**
 * Call `onChange` whenever this Member's view-state revision moves — the push
 * stream from their ViewStateDO. That is what makes a second tab, or a `crux`
 * command in a terminal, land on the page without a manual refresh.
 */
export function onViewStateChange(onChange: () => void): () => void {
  const source = new EventSource("/v1/view/stream");
  source.addEventListener("view", onChange);
  return () => source.close();
}
