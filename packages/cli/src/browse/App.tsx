import React, { useEffect, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { getWorkstreamBySlug, type Workstream } from "./queries.js";
import {
  IdeasQueueView,
  IntakeQueueView,
  ObservationDetailView,
  ProblemDetailView,
  SolutionDetailView,
  WorkstreamDashboard,
  WorkstreamPicker,
} from "./views.js";

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

  useEffect(() => {
    if (!initialSlug) return;
    getWorkstreamBySlug(initialSlug).then((ws) => {
      if (!ws) {
        setBootError(`workstream not found: ${initialSlug}`);
      } else {
        setView({ kind: "dashboard", workstream: ws });
      }
      setBooted(true);
    });
  }, [initialSlug]);

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
    setView((v) => {
      switch (v.kind) {
        case "picker":
          return v;
        case "dashboard":
          return initialSlug ? v : { kind: "picker" };
        case "problem":
          return { kind: "dashboard", workstream: v.workstream };
        case "solution":
          if (v.parent === "problem" && v.problemId) {
            return { kind: "problem", workstream: v.workstream, problemId: v.problemId };
          }
          return { kind: "dashboard", workstream: v.workstream };
        case "observation":
          if (v.parent === "problem" && v.problemId) {
            return { kind: "problem", workstream: v.workstream, problemId: v.problemId };
          }
          return { kind: "intake", workstream: v.workstream };
        case "intake":
        case "ideas":
          return { kind: "dashboard", workstream: v.workstream };
      }
    });
  };

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
      return <WorkstreamPicker onSelect={(ws) => setView({ kind: "dashboard", workstream: ws })} />;
    case "dashboard":
      return (
        <WorkstreamDashboard
          workstream={view.workstream}
          showArchived={showArchived}
          onOpenProblem={(problemId) =>
            setView({ kind: "problem", workstream: view.workstream, problemId })
          }
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
