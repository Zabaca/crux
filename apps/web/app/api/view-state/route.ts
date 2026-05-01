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
  console.log("[view-state GET] Resolved path:", path);

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
        console.log("[view-state GET init]", { value: snap.value, context: snap.context });
        send({
          type: "init",
          value: snap.value,
          context: snap.context,
          revision: meta.revision,
          lastAction: meta.lastAction,
          recentQueries: meta.recentQueries,
        });
      } catch (err) {
        console.error("[view-state GET init error]", err);
        send({
          type: "init",
          value: { viewing: "workstream_list" },
          context: { workstreamId: null, problemId: null },
          revision: 0,
          lastAction: null,
          recentQueries: [],
        });
      }

      const handle = watchViewStateFile(path, () => {
        console.log("[view-state WATCH] File changed");
        try {
          const snap = loadState(path);
          const meta = loadViewMeta(path);
          console.log("[view-state WATCH change]", { value: snap.value, context: snap.context });
          send({
            type: "change",
            value: snap.value,
            context: snap.context,
            revision: meta.revision,
            lastAction: meta.lastAction,
            recentQueries: meta.recentQueries,
          });
        } catch (err) {
          console.error("[view-state WATCH error]", err);
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
 * Write-back: accept a target {workstreamId, problemId} from the web UI
 * and apply the right event sequence so the view-state file stays in sync with
 * where the user actually is. Errors are swallowed — sync is best-effort.
 */
export async function POST(req: Request) {
  try {
    const { workstreamId, problemId, queue } = (await req.json()) as {
      workstreamId: string | null;
      problemId: string | null;
      queue?: "intake" | null;
    };

    const current = loadState();
    const leaf = JSON.stringify(current.value);

    // Helper: ensure we're at workstream_dashboard for the given id.
    const ensureAtDashboard = async (id: string) => {
      if (current.context.workstreamId !== id) {
        if (!leaf.includes("workstream_list")) await sendViewEvent({ type: "BACK" });
        await sendViewEvent({ type: "SELECT_WORKSTREAM", id });
      } else if (leaf.includes("problem_detail") || leaf.includes("intake_queue")) {
        await sendViewEvent({ type: "BACK" });
      }
    };

    if (problemId && workstreamId) {
      if (current.context.workstreamId !== workstreamId) {
        await sendViewEvent({ type: "SELECT_WORKSTREAM", id: workstreamId });
      }
      await sendViewEvent({ type: "OPEN_PROBLEM", id: problemId });
    } else if (queue === "intake" && workstreamId) {
      await ensureAtDashboard(workstreamId);
      await sendViewEvent({ type: "SELECT_INTAKE" });
    } else if (workstreamId) {
      await ensureAtDashboard(workstreamId);
    } else {
      if (!leaf.includes("workstream_list")) await sendViewEvent({ type: "BACK" });
    }

    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false });
  }
}
