import { useEffect, useState } from "react";
import { formatStateValue, type ViewEvent } from "@crux/core/view-state";
import { api } from "../api-client.js";

export type MachineView =
  | { kind: "workstream_list" }
  | { kind: "workstream_dashboard"; workstreamId: string }
  | { kind: "problem_detail"; workstreamId: string; problemId: number }
  | { kind: "intake_queue"; workstreamId: string };

type ViewSnapshotLike = {
  value: unknown;
  context: { workstreamId?: string | null; problemId?: string | null };
};

const INITIAL: ViewSnapshotLike = { value: { viewing: "workstream_list" }, context: {} };

export function snapshotToView(snapshot: ViewSnapshotLike): MachineView {
  const value = formatStateValue(snapshot.value as never);
  const ctx = snapshot.context;
  const wsId = ctx.workstreamId ?? null;
  const probId = ctx.problemId ? parseInt(ctx.problemId, 10) : null;
  if (value.endsWith("problem_detail") && wsId && probId !== null && !isNaN(probId)) {
    return { kind: "problem_detail", workstreamId: wsId, problemId: probId };
  }
  if (value.endsWith("intake_queue") && wsId) {
    return { kind: "intake_queue", workstreamId: wsId };
  }
  if (value.endsWith("workstream_dashboard") && wsId) {
    return { kind: "workstream_dashboard", workstreamId: wsId };
  }
  return { kind: "workstream_list" };
}

/** How often the TUI re-reads view-state that another client may have moved. */
const POLL_MS = 1000;

/**
 * View-state as the deployment holds it. Locally this was a file with a
 * watcher; the per-user Durable Object is reached over HTTP instead, so the TUI
 * polls it — which is also what makes a second client's navigation show up here.
 */
export function useViewState(): {
  machineView: MachineView;
  send: (event: ViewEvent) => Promise<void>;
} {
  const [machineView, setMachineView] = useState<MachineView>(() => snapshotToView(INITIAL));

  useEffect(() => {
    let stopped = false;
    const refresh = async () => {
      try {
        const snap = await api().get<ViewSnapshotLike>("/v1/view");
        if (!stopped) setMachineView(snapshotToView(snap));
      } catch {
        // ignore transient read errors
      }
    };
    void refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  const send = async (event: ViewEvent) => {
    const { type, ...payload } = event;
    const { viewState } = await api().dispatch({ kind: type, payload });
    setMachineView(snapshotToView({ value: viewState, context: contextFrom(event, machineView) }));
  };

  return { machineView, send };
}

/**
 * The context the event just produced. `dispatch` answers with the new state
 * value only, and the next poll brings the authoritative context along — this
 * keeps the view from lagging a tick behind the keypress that moved it.
 */
function contextFrom(
  event: ViewEvent,
  current: MachineView,
): { workstreamId: string | null; problemId: string | null } {
  const workstreamId = "workstreamId" in current ? current.workstreamId : null;
  const problemId = current.kind === "problem_detail" ? String(current.problemId) : null;
  if (event.type === "SELECT_WORKSTREAM") return { workstreamId: event.id, problemId: null };
  if (event.type === "OPEN_PROBLEM") return { workstreamId, problemId: event.id };
  return { workstreamId, problemId };
}
