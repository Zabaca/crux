/**
 * POST /api/action — single write entry point for the web UI.
 *
 * Pipeline: parse → allow-check (always-on for UI) → dispatch → respond.
 * No CSRF/auth: local single-user dev tool. SSE listener picks up the
 * revision bump and triggers router.refresh() — no extra signaling here.
 */
import { dispatch, ActionNotAllowedError } from "@crux/core/actions";
import { ActionSchema } from "@crux/core/actions";

export const dynamic = "force-dynamic";

type ErrorBody = {
  ok: false;
  code: "INVALID_PAYLOAD" | "ACTION_NOT_ALLOWED" | "TRANSITION_ERROR";
  message: string;
  allowed?: string[];
};

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      {
        ok: false,
        code: "INVALID_PAYLOAD",
        message: "request body is not valid JSON",
      } satisfies ErrorBody,
      { status: 400 },
    );
  }

  const parsed = ActionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        code: "INVALID_PAYLOAD",
        message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      } satisfies ErrorBody,
      { status: 400 },
    );
  }

  try {
    const result = await dispatch(parsed.data, { enforceAllow: true });
    return Response.json({ ok: true, revision: result.revision, result: result.result });
  } catch (err) {
    if (err instanceof ActionNotAllowedError) {
      return Response.json(
        {
          ok: false,
          code: "ACTION_NOT_ALLOWED",
          message: err.message,
          allowed: [...new Set([...err.allowedView, ...err.allowedMutation, ...err.globals])],
        } satisfies ErrorBody,
        { status: 403 },
      );
    }
    return Response.json(
      {
        ok: false,
        code: "TRANSITION_ERROR",
        message: err instanceof Error ? err.message : String(err),
      } satisfies ErrorBody,
      { status: 500 },
    );
  }
}
