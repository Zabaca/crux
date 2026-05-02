import { useEffect, useState } from "react";
import {
  formatStateValue,
  loadState,
  resolveViewStatePath,
  sendViewEvent,
  watchViewStateFile,
  type ViewEvent,
} from "@crux/core/view-state";

export type MachineView =
  | { kind: "workstream_list" }
  | { kind: "workstream_dashboard"; workstreamId: string }
  | { kind: "problem_detail"; workstreamId: string; problemId: number }
  | { kind: "intake_queue"; workstreamId: string };

export function snapshotToView(snapshot: ReturnType<typeof loadState>): MachineView {
  const value = formatStateValue(snapshot.value);
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

export function useViewStateFile(): {
  machineView: MachineView;
  send: (event: ViewEvent) => Promise<void>;
} {
  const [machineView, setMachineView] = useState<MachineView>(() => snapshotToView(loadState()));

  useEffect(() => {
    const refresh = () => {
      try {
        setMachineView(snapshotToView(loadState()));
      } catch {
        // ignore transient read errors
      }
    };
    const handle = watchViewStateFile(resolveViewStatePath(), refresh);
    return () => {
      handle.stop();
    };
  }, []);

  const send = async (event: ViewEvent) => {
    const snap = await sendViewEvent(event);
    setMachineView(snapshotToView(snap));
  };

  return { machineView, send };
}
