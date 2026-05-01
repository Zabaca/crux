import {
  loadState,
  loadViewMeta,
  resolveViewStatePath,
  sendViewEvent,
  watchViewStateFile,
} from "@crux/core/view-state";
import { VIEW_ACTION_KINDS } from "@crux/core/actions";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();
  const path = resolveViewStatePath();

  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          // stream closed
        }
      };

      // Emit initial state so the client knows the current machine state,
      // but tagged "init" so the listener doesn't navigate on connect.
      try {
        const snap = loadState(path);
        const meta = loadViewMeta(path);
        send({
          type: "init",
          value: snap.value,
          context: snap.context,
          revision: meta.revision,
          lastAction: meta.lastAction,
        });
      } catch {
        send({
          type: "init",
          value: { viewing: "workstream_list" },
          context: { workstreamSlug: null, problemSlug: null },
          revision: 0,
          lastAction: null,
        });
      }

      const handle = watchViewStateFile(path, () => {
        try {
          const snap = loadState(path);
          const meta = loadViewMeta(path);
          send({
            type: "change",
            value: snap.value,
            context: snap.context,
            revision: meta.revision,
            lastAction: meta.lastAction,
          });
        } catch {
          // ignore transient errors
        }
      });
      void VIEW_ACTION_KINDS; // used in listener branching, kept here for import

      // Heartbeat to keep the connection alive through proxies.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          // ignore
        }
      }, 15_000);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (controller as any)._cleanup = async () => {
        clearInterval(heartbeat);
        await handle.stop();
      };
    },
    async cancel(reason) {
      void reason;
      // best-effort cleanup
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

/**
 * Write-back: accept a target {workstreamSlug, problemSlug} from the web UI
 * and apply the right event sequence so the view-state file stays in sync with
 * where the user actually is. Errors are swallowed — sync is best-effort.
 */
export async function POST(req: Request) {
  try {
    const { workstreamSlug, problemSlug, queue } = (await req.json()) as {
      workstreamSlug: string | null;
      problemSlug: string | null;
      queue?: "intake" | "ideas" | null;
    };

    const current = loadState();
    const leaf = JSON.stringify(current.value);

    // Helper: ensure we're at workstream_dashboard for the given slug.
    const ensureAtDashboard = async (slug: string) => {
      if (current.context.workstreamSlug !== slug) {
        if (!leaf.includes("workstream_list")) await sendViewEvent({ type: "BACK" });
        await sendViewEvent({ type: "SELECT_WORKSTREAM", slug });
      } else if (
        leaf.includes("problem_detail") ||
        leaf.includes("intake_queue") ||
        leaf.includes("ideas_queue")
      ) {
        await sendViewEvent({ type: "BACK" });
      }
    };

    if (problemSlug && workstreamSlug) {
      if (current.context.workstreamSlug !== workstreamSlug) {
        await sendViewEvent({ type: "SELECT_WORKSTREAM", slug: workstreamSlug });
      }
      await sendViewEvent({ type: "OPEN_PROBLEM", slug: problemSlug });
    } else if (queue && workstreamSlug) {
      await ensureAtDashboard(workstreamSlug);
      await sendViewEvent({ type: queue === "intake" ? "SELECT_INTAKE" : "SELECT_IDEAS" });
    } else if (workstreamSlug) {
      await ensureAtDashboard(workstreamSlug);
    } else {
      if (!leaf.includes("workstream_list")) await sendViewEvent({ type: "BACK" });
    }

    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false });
  }
}
