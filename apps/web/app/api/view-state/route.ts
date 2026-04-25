import { loadState, resolveViewStatePath, watchViewStateFile } from "@crux/core/view-state";

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

      // Emit initial state immediately so clients don't wait for the first write.
      try {
        const snap = loadState(path);
        send({ value: snap.value, context: snap.context });
      } catch {
        send({
          value: { viewing: "workstream_list" },
          context: { workstreamSlug: null, problemSlug: null },
        });
      }

      const handle = watchViewStateFile(path, () => {
        try {
          const snap = loadState(path);
          send({ value: snap.value, context: snap.context });
        } catch {
          // ignore transient errors
        }
      });

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
