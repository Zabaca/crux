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
  | { kind: "workstream_dashboard"; workstreamSlug: string }
  | { kind: "problem_detail"; workstreamSlug: string; problemSlug: string }
  | { kind: "intake_queue"; workstreamSlug: string }
  | { kind: "ideas_queue"; workstreamSlug: string };

export function snapshotToView(snapshot: ReturnType<typeof loadState>): MachineView {
  const value = formatStateValue(snapshot.value);
  const ctx = snapshot.context;
  if (value.endsWith("problem_detail") && ctx.workstreamSlug && ctx.problemSlug) {
    return {
      kind: "problem_detail",
      workstreamSlug: ctx.workstreamSlug,
      problemSlug: ctx.problemSlug,
    };
  }
  if (value.endsWith("intake_queue") && ctx.workstreamSlug) {
    return { kind: "intake_queue", workstreamSlug: ctx.workstreamSlug };
  }
  if (value.endsWith("ideas_queue") && ctx.workstreamSlug) {
    return { kind: "ideas_queue", workstreamSlug: ctx.workstreamSlug };
  }
  if (value.endsWith("workstream_dashboard") && ctx.workstreamSlug) {
    return { kind: "workstream_dashboard", workstreamSlug: ctx.workstreamSlug };
  }
  return { kind: "workstream_list" };
}

/**
 * Subscribe to the view-state file. Returns the current machine-derived view
 * plus a `send` to drive transitions through the bus.
 *
 * Surfaces a simple 3-value view (the machine-covered subset). Screens outside
 * the machine's scope (solution/observation/queues) stay managed locally.
 */
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
