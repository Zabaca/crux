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

/** What the `view` frame carries: the revision, and where the change happened. */
export type ViewStateChange = {
  revision: number;
  /** The Workstream the action touched, or null when it touched none. */
  workstreamId: string | null;
};

/**
 * Call `onChange` whenever this Member's view-state revision moves — the push
 * stream from their ViewStateDO. That is what makes a second tab, or a `crux`
 * command in a terminal, land on the page without a manual refresh.
 *
 * Pass `opts.workstreamId` to hear only about that Workstream. Agents work
 * several in parallel, so an unfiltered subscription on a page showing one of
 * them is interruption rather than freshness. A frame with no Workstream (a
 * navigation, a RESET) is dropped by a filtered subscriber: it changed nothing
 * the page is showing.
 */
export function onViewStateChange(
  onChange: (change: ViewStateChange) => void,
  opts: { workstreamId?: string } = {},
): () => void {
  const source = new EventSource("/v1/view/stream");
  source.addEventListener("view", (event) => {
    const change = parseViewFrame((event as MessageEvent).data);
    if (!change) return;
    if (opts.workstreamId && change.workstreamId !== opts.workstreamId) return;
    onChange(change);
  });
  return () => source.close();
}

/**
 * A frame from a deployment that predates `workstreamId` still parses — the
 * field reads as null, which an unfiltered subscriber ignores and a filtered
 * one treats as "not mine".
 */
function parseViewFrame(data: unknown): ViewStateChange | null {
  if (typeof data !== "string") return null;
  try {
    const parsed = JSON.parse(data) as { revision?: unknown; workstreamId?: unknown };
    return {
      revision: typeof parsed.revision === "number" ? parsed.revision : 0,
      workstreamId: typeof parsed.workstreamId === "string" ? parsed.workstreamId : null,
    };
  } catch {
    return null;
  }
}
