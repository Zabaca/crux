import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { KeyBar, Screen, type KeyHint } from "@crux/tui-ds/components";
import { getDb } from "@crux/core";
import { workstreams } from "@crux/core/db/schema";
import { eq } from "drizzle-orm";
import { getProblemById, getWorkstreamBySlug, type Workstream } from "./queries.js";
import {
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
  | { kind: "problem"; workstream: Workstream; problemId: number }
  | {
      kind: "solution";
      workstream: Workstream;
      solutionId: number;
      parent: "problem" | "dashboard";
      problemId?: number;
    }
  | {
      kind: "observation";
      workstream: Workstream;
      observationId: string;
      parent: "problem" | "intake";
      problemId?: number;
    }
  | { kind: "intake"; workstream: Workstream };

async function getWorkstreamById(id: string): Promise<Workstream | null> {
  const rows = await getDb().select().from(workstreams).where(eq(workstreams.id, id)).limit(1);
  return rows[0] ?? null;
}

export function App({ initialSlug }: { initialSlug?: string }): React.ReactElement {
  const { exit } = useApp();
  const [view, setView] = useState<View>({ kind: "picker" });
  const [showArchived, setShowArchived] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [booted, setBooted] = useState(!initialSlug);
  const { machineView, send } = useViewStateFile();

  const lastAppliedMachineView = useRef<string>("");

  useEffect(() => {
    if (!initialSlug) return;
    getWorkstreamBySlug(initialSlug).then((ws) => {
      if (!ws) {
        setBootError(`workstream not found: ${initialSlug}`);
      } else {
        setView({ kind: "dashboard", workstream: ws });
        send({ type: "SELECT_WORKSTREAM", id: ws.id }).catch(() => {});
      }
      setBooted(true);
    });
  }, [initialSlug]);

  useEffect(() => {
    const key = JSON.stringify(machineView);
    if (key === lastAppliedMachineView.current) return;
    lastAppliedMachineView.current = key;

    let cancelled = false;
    (async () => {
      if (machineView.kind === "workstream_list") {
        if (cancelled) return;
        setView((v) => {
          if (initialSlug && v.kind === "dashboard") return v;
          return { kind: "picker" };
        });
        return;
      }
      if (machineView.kind === "workstream_dashboard") {
        const ws = await getWorkstreamById(machineView.workstreamId);
        if (cancelled || !ws) return;
        setView({ kind: "dashboard", workstream: ws });
        return;
      }
      if (machineView.kind === "problem_detail") {
        const ws = await getWorkstreamById(machineView.workstreamId);
        const p = await getProblemById(machineView.problemId);
        if (cancelled || !ws || !p) return;
        setView({ kind: "problem", workstream: ws, problemId: p.id });
        return;
      }
      if (machineView.kind === "intake_queue") {
        const ws = await getWorkstreamById(machineView.workstreamId);
        if (cancelled || !ws) return;
        setView({ kind: "intake", workstream: ws });
        return;
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
          send({ type: "BACK" }).catch(() => {});
        }
        return;
      case "problem":
        send({ type: "BACK" }).catch(() => {});
        return;
      case "solution":
        if (v.parent === "problem" && v.problemId !== undefined) {
          setView({ kind: "problem", workstream: v.workstream, problemId: v.problemId });
        } else {
          setView({ kind: "dashboard", workstream: v.workstream });
        }
        return;
      case "observation":
        if (v.parent === "problem" && v.problemId !== undefined) {
          setView({ kind: "problem", workstream: v.workstream, problemId: v.problemId });
        } else {
          setView({ kind: "intake", workstream: v.workstream });
        }
        return;
      case "intake":
        setView({ kind: "dashboard", workstream: v.workstream });
        return;
    }
  };

  const openProblem = async (problemId: number) => {
    await send({ type: "OPEN_PROBLEM", id: String(problemId) }).catch(() => {});
  };

  const openWorkstream = async (ws: Workstream) => {
    await send({ type: "SELECT_WORKSTREAM", id: ws.id }).catch(() => {
      setView({ kind: "dashboard", workstream: ws });
    });
  };

  const body = renderBody();
  const hints = hintsForView(view, showArchived);

  function hintsForView(v: View, archived: boolean): KeyHint[] {
    const archivedHint: KeyHint = { key: "a", label: archived ? "hide archived" : "show archived" };
    switch (v.kind) {
      case "picker":
        return [
          { key: "↑↓", label: "nav" },
          { key: "↵", label: "open" },
          { key: "q", label: "quit" },
        ];
      case "dashboard":
        return [
          { key: "↑↓", label: "nav" },
          { key: "↵", label: "open" },
          { key: "esc", label: "back" },
          archivedHint,
          { key: "i", label: "intake" },
          { key: "q", label: "quit" },
        ];
      case "problem":
        return [
          { key: "↑↓", label: "nav" },
          { key: "↵", label: "open" },
          { key: "tab", label: "switch section" },
          { key: "esc", label: "back" },
          { key: "q", label: "quit" },
        ];
      case "solution":
        return [
          { key: "esc", label: "back" },
          { key: "q", label: "quit" },
        ];
      case "observation":
        return [
          { key: "esc", label: "back" },
          { key: "q", label: "quit" },
        ];
      case "intake":
        return [
          { key: "↑↓", label: "nav" },
          { key: "↵", label: "open" },
          { key: "esc", label: "back" },
          archivedHint,
          { key: "q", label: "quit" },
        ];
    }
  }

  return <Screen footer={<KeyBar hints={hints} />}>{body}</Screen>;

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
          />
        );
      case "problem":
        return (
          <ProblemDetailView
            workstream={view.workstream}
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
    }
  }
}
