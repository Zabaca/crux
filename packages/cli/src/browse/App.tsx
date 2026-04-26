import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { useTerminalSize } from "@crux/tui-ds/hooks";
import {
  getProblemById,
  getProblemBySlug,
  getWorkstreamBySlug,
  type Workstream,
} from "./queries.js";
import {
  IdeasQueueView,
  IntakeQueueView,
  ObservationDetailView,
  ProblemDetailView,
  SolutionDetailView,
  WorkstreamDashboard,
  WorkstreamPicker,
} from "./views.js";
import { useViewStateFile } from "./useViewState.js";

type View =
  | { kind: "picker" }
  | { kind: "dashboard"; workstream: Workstream }
  | { kind: "problem"; workstream: Workstream; problemId: string }
  | {
      kind: "solution";
      workstream: Workstream;
      solutionId: string;
      parent: "problem" | "dashboard";
      problemId?: string;
    }
  | {
      kind: "observation";
      workstream: Workstream;
      observationId: string;
      parent: "problem" | "intake";
      problemId?: string;
    }
  | { kind: "intake"; workstream: Workstream }
  | { kind: "ideas"; workstream: Workstream };

export function App({ initialSlug }: { initialSlug?: string }): React.ReactElement {
  const { exit } = useApp();
  const [view, setView] = useState<View>({ kind: "picker" });
  const [showArchived, setShowArchived] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [booted, setBooted] = useState(!initialSlug);
  const { machineView, send } = useViewStateFile();
  const { rows } = useTerminalSize();

  // Track the last machineView we applied, so we don't re-apply identical state
  // and don't clobber local non-machine views (e.g. solution/observation).
  const lastAppliedMachineView = useRef<string>("");

  useEffect(() => {
    if (!initialSlug) return;
    getWorkstreamBySlug(initialSlug).then((ws) => {
      if (!ws) {
        setBootError(`workstream not found: ${initialSlug}`);
      } else {
        setView({ kind: "dashboard", workstream: ws });
        send({ type: "SELECT_WORKSTREAM", slug: initialSlug }).catch(() => {
          // guard may refuse if initialSlug is exotic; local view still works
        });
      }
      setBooted(true);
    });
  }, [initialSlug]);

  // Reconcile incoming machine state → local view. Only applies when we're on
  // a machine-covered screen (picker/dashboard/problem) or the incoming machine
  // view disagrees with where we are.
  useEffect(() => {
    const key = JSON.stringify(machineView);
    if (key === lastAppliedMachineView.current) return;
    lastAppliedMachineView.current = key;

    let cancelled = false;
    (async () => {
      if (machineView.kind === "workstream_list") {
        if (cancelled) return;
        setView((v) => {
          // If caller booted with initialSlug, don't demote below dashboard.
          if (initialSlug && v.kind === "dashboard") return v;
          return { kind: "picker" };
        });
        return;
      }
      if (machineView.kind === "workstream_dashboard") {
        const ws = await getWorkstreamBySlug(machineView.workstreamSlug);
        if (cancelled || !ws) return;
        setView({ kind: "dashboard", workstream: ws });
        return;
      }
      if (machineView.kind === "problem_detail") {
        const ws = await getWorkstreamBySlug(machineView.workstreamSlug);
        const p = await getProblemBySlug(machineView.problemSlug);
        if (cancelled || !ws || !p) return;
        setView({ kind: "problem", workstream: ws, problemId: p.id });
        return;
      }
      if (machineView.kind === "intake_queue") {
        const ws = await getWorkstreamBySlug(machineView.workstreamSlug);
        if (cancelled || !ws) return;
        setView({ kind: "intake", workstream: ws });
        return;
      }
      if (machineView.kind === "ideas_queue") {
        const ws = await getWorkstreamBySlug(machineView.workstreamSlug);
        if (cancelled || !ws) return;
        setView({ kind: "ideas", workstream: ws });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [machineView, initialSlug]);

  useInput((input, key) => {
    if (input === "q") {
      exit();
      return;
    }
    if (key.escape || key.backspace || key.delete) {
      goBack();
      return;
    }
    if (input === "a") {
      setShowArchived((x) => !x);
    }
  });

  const goBack = () => {
    const v = view;
    switch (v.kind) {
      case "picker":
        return;
      case "dashboard":
        if (!initialSlug) {
          // Machine-covered transition: dashboard → list.
          send({ type: "BACK" }).catch(() => {});
        }
        return;
      case "problem":
        // Machine-covered transition: problem_detail → dashboard.
        send({ type: "BACK" }).catch(() => {});
        return;
      case "solution":
        if (v.parent === "problem" && v.problemId) {
          setView({ kind: "problem", workstream: v.workstream, problemId: v.problemId });
        } else {
          setView({ kind: "dashboard", workstream: v.workstream });
        }
        return;
      case "observation":
        if (v.parent === "problem" && v.problemId) {
          setView({ kind: "problem", workstream: v.workstream, problemId: v.problemId });
        } else {
          setView({ kind: "intake", workstream: v.workstream });
        }
        return;
      case "intake":
      case "ideas":
        setView({ kind: "dashboard", workstream: v.workstream });
        return;
    }
  };

  const openProblem = async (problemId: string) => {
    const p = await getProblemById(problemId);
    if (!p) return;
    await send({ type: "OPEN_PROBLEM", slug: p.slug }).catch(() => {});
  };

  const openWorkstream = async (ws: Workstream) => {
    await send({ type: "SELECT_WORKSTREAM", slug: ws.slug }).catch(() => {
      // If guard refuses, fall back to local nav so the UI stays usable.
      setView({ kind: "dashboard", workstream: ws });
    });
  };

  const body = renderBody();

  return (
    <Box flexDirection="column" height={rows}>
      {body}
    </Box>
  );

  function renderBody(): React.ReactElement {
    if (!booted) return <Text color="gray">loading…</Text>;

    if (bootError) {
      return (
        <Box flexDirection="column">
          <Text color="red">{bootError}</Text>
          <Text color="gray">press q to quit</Text>
        </Box>
      );
    }

    switch (view.kind) {
      case "picker":
        return <WorkstreamPicker onSelect={(ws) => void openWorkstream(ws)} />;
      case "dashboard":
        return (
          <WorkstreamDashboard
            workstream={view.workstream}
            showArchived={showArchived}
            onOpenProblem={(problemId) => void openProblem(problemId)}
            onOpenIntake={() => setView({ kind: "intake", workstream: view.workstream })}
            onOpenIdeas={() => setView({ kind: "ideas", workstream: view.workstream })}
          />
        );
      case "problem":
        return (
          <ProblemDetailView
            problemId={view.problemId}
            onOpenSolution={(solutionId) =>
              setView({
                kind: "solution",
                workstream: view.workstream,
                solutionId,
                parent: "problem",
                problemId: view.problemId,
              })
            }
            onOpenObservation={(observationId) =>
              setView({
                kind: "observation",
                workstream: view.workstream,
                observationId,
                parent: "problem",
                problemId: view.problemId,
              })
            }
          />
        );
      case "solution":
        return <SolutionDetailView solutionId={view.solutionId} />;
      case "observation":
        return <ObservationDetailView observationId={view.observationId} />;
      case "intake":
        return (
          <IntakeQueueView
            workstream={view.workstream}
            showArchived={showArchived}
            onOpenObservation={(observationId) =>
              setView({
                kind: "observation",
                workstream: view.workstream,
                observationId,
                parent: "intake",
              })
            }
          />
        );
      case "ideas":
        return <IdeasQueueView workstream={view.workstream} showArchived={showArchived} />;
    }
  }
}
