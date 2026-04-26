import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import {
  getProblemDetail,
  getSolutionDetail,
  getObservationDetail,
  listOpenProblems,
  listUnlinkedObservations,
  listUnpromotedIdeas,
  listWorkstreams,
  type Idea,
  type Observation,
  type ObservationDetail,
  type ProblemDetail,
  type ProblemSummary,
  type SolutionDetail,
  type Workstream,
} from "./queries.js";
import {
  ArchivedTag,
  Empty,
  Footer,
  LifecycleBadge,
  PriorityBadge,
  SectionTitle,
  SolutionStatusBadge,
} from "./components.js";
import { ScrollableList, type ScrollableListItem } from "@crux/tui-ds/components";

type WorkstreamRow = Workstream & { openProblemCount: number };

// ---------- Workstream picker ----------

export function WorkstreamPicker({
  onSelect,
}: {
  onSelect: (ws: Workstream) => void;
}): React.ReactElement {
  const [rows, setRows] = useState<WorkstreamRow[] | null>(null);

  useEffect(() => {
    listWorkstreams().then(setRows);
  }, []);

  if (!rows) return <Text color="gray">loading workstreams…</Text>;

  if (rows.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold>Workstreams</Text>
        <Empty label="no workstreams" />
        <Footer hints={[["q", "quit"]]} />
      </Box>
    );
  }

  const items = rows.map((r) => ({
    key: r.id,
    label: `${r.slug.padEnd(30)} ${r.title}  (${r.openProblemCount} open)`,
    value: r.id,
  }));

  const handle = (item: { value: string }) => {
    const row = rows.find((r) => r.id === item.value);
    if (row) onSelect(row);
  };

  return (
    <Box flexDirection="column">
      <Text bold>Workstreams</Text>
      <SelectInput items={items} onSelect={handle} />
      <Footer
        hints={[
          ["↑↓", "nav"],
          ["↵", "open"],
          ["q", "quit"],
        ]}
      />
    </Box>
  );
}

// ---------- Workstream dashboard ----------

type DashboardEntry = { kind: "problem"; problem: ProblemSummary };

export function WorkstreamDashboard({
  workstream,
  showArchived,
  onOpenProblem,
  onOpenIntake: _onOpenIntake,
  onOpenIdeas: _onOpenIdeas,
}: {
  workstream: Workstream;
  showArchived: boolean;
  onOpenProblem: (problemId: string) => void;
  onOpenIntake: () => void;
  onOpenIdeas: () => void;
}): React.ReactElement {
  const [rows, setRows] = useState<ProblemSummary[] | null>(null);
  const [intakeCount, setIntakeCount] = useState<number | null>(null);
  const [ideasCount, setIdeasCount] = useState<number | null>(null);
  const [highlighted, setHighlighted] = useState<DashboardEntry | null>(null);

  useEffect(() => {
    listOpenProblems(workstream.id).then((all) => {
      const open = all.filter(
        (p) =>
          p.lifecycleStatus === "shaping" ||
          p.lifecycleStatus === "committed" ||
          p.lifecycleStatus === "shipping",
      );
      setRows(open);
      if (!highlighted && open[0]) setHighlighted({ kind: "problem", problem: open[0] });
    });
    listUnlinkedObservations(workstream.id, showArchived).then((os) => setIntakeCount(os.length));
    listUnpromotedIdeas(workstream.id, showArchived).then((is) => setIdeasCount(is.length));
  }, [workstream.id, showArchived]);

  if (!rows || intakeCount === null || ideasCount === null) {
    return <Text color="gray">loading dashboard…</Text>;
  }

  const problemItems: ScrollableListItem[] = rows.map((p) => ({
    slug: p.slug,
    title: p.title,
    badges: <PriorityBadge tier={p.priorityTier} />,
    meta: `ev:${p.evidenceCount} sol:${p.solutionCount}`,
  }));

  const onListFocus = (_item: ScrollableListItem, index: number) => {
    const p = rows[index];
    if (p) setHighlighted({ kind: "problem", problem: p });
  };
  const onListSelect = (_item: ScrollableListItem, index: number) => {
    const p = rows[index];
    if (p) onOpenProblem(p.id);
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>
          {workstream.slug} — {workstream.title}
        </Text>
        {showArchived ? <Text color="gray"> (show-archived)</Text> : null}
      </Box>

      <Box>
        <Box flexDirection="column" width="50%" paddingRight={1}>
          {rows.length === 0 ? (
            <Empty label="no open problems" />
          ) : (
            <ScrollableList items={problemItems} onFocus={onListFocus} onSelect={onListSelect} />
          )}
          <Box marginTop={1} flexDirection="column">
            <Text color="gray"> Intake queue ({intakeCount} unlinked)</Text>
            <Text color="gray"> Ideas queue ({ideasCount} unpromoted)</Text>
          </Box>
        </Box>
        <Box
          flexDirection="column"
          width="50%"
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
        >
          <DashboardDetail entry={highlighted} />
        </Box>
      </Box>
      <Footer
        hints={[
          ["↑↓", "nav"],
          ["↵", "open"],
          ["esc", "back"],
          ["a", showArchived ? "hide archived" : "show archived"],
          ["q", "quit"],
        ]}
      />
    </Box>
  );
}

function DashboardDetail({ entry }: { entry: DashboardEntry | null }): React.ReactElement {
  if (!entry) return <Text color="gray">(nothing selected)</Text>;
  const p = entry.problem;
  return (
    <Box flexDirection="column">
      <Box>
        <PriorityBadge tier={p.priorityTier} />
        <Text> </Text>
        <LifecycleBadge status={p.lifecycleStatus} />
      </Box>
      <Box marginTop={1}>
        <Text bold>{p.slug}</Text>
      </Box>
      <Text>{p.title}</Text>
      <Box marginTop={1}>
        <Text color="gray">
          ev:{p.evidenceCount} sol:{p.solutionCount}
        </Text>
      </Box>
      {p.description ? (
        <Box marginTop={1}>
          <Text>{truncate(p.description, 400)}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

// ---------- Problem detail ----------

type ProblemTarget =
  | { kind: "evidence"; evidenceId: string }
  | { kind: "solution"; solutionId: string }
  | { kind: "decision" }
  | { kind: "elimination"; eliminationId: string }
  | { kind: "abandonment" }
  | { kind: "outcome"; solutionId: string };

export function ProblemDetailView({
  problemId,
  onOpenSolution,
  onOpenObservation,
}: {
  problemId: string;
  onOpenSolution: (solutionId: string) => void;
  onOpenObservation: (observationId: string) => void;
}): React.ReactElement {
  const [data, setData] = useState<ProblemDetail | null>(null);
  const [highlighted, setHighlighted] = useState<ProblemTarget | null>(null);

  useEffect(() => {
    getProblemDetail(problemId).then((d) => {
      setData(d);
    });
  }, [problemId]);

  if (!data) return <Text color="gray">loading problem…</Text>;

  const { problem, evidence, solutions, latestDecision, eliminations, abandonment } = data;

  type Row = { item: ScrollableListItem; target: ProblemTarget; onSelect: () => void };
  const rows: Row[] = [];

  for (const e of evidence) {
    const obs = e.observation;
    rows.push({
      item: {
        slug: obs ? obs.id : "?",
        title: obs ? obs.content : "(missing observation)",
        meta: obs?.archive ? "archived" : undefined,
      },
      target: { kind: "evidence", evidenceId: e.id },
      onSelect: () => {
        if (e.observationId) onOpenObservation(e.observationId);
      },
    });
  }
  for (const s of solutions) {
    rows.push({
      item: {
        slug: s.slug,
        title: s.title,
        badges: <SolutionStatusBadge status={s.status} />,
      },
      target: { kind: "solution", solutionId: s.id },
      onSelect: () => onOpenSolution(s.id),
    });
  }
  if (latestDecision) {
    rows.push({
      item: {
        slug: latestDecision.id,
        title: `decision — chose ${latestDecision.chosenSolutionId}`,
      },
      target: { kind: "decision" },
      onSelect: () => {},
    });
  }
  for (const el of eliminations) {
    rows.push({
      item: {
        slug: el.id,
        title: `elimination (${el.eliminatedSolutionIds.length} targets)`,
      },
      target: { kind: "elimination", eliminationId: el.id },
      onSelect: () => {},
    });
  }
  if (abandonment) {
    rows.push({
      item: { slug: abandonment.id, title: "abandonment" },
      target: { kind: "abandonment" },
      onSelect: () => {},
    });
  }
  for (const s of solutions) {
    if (s.outcome) {
      rows.push({
        item: { slug: s.outcome.id, title: `outcome (sol ${s.slug})` },
        target: { kind: "outcome", solutionId: s.id },
        onSelect: () => onOpenSolution(s.id),
      });
    }
  }

  const listItems = rows.map((r) => r.item);
  const onListFocus = (_item: ScrollableListItem, index: number) => {
    const r = rows[index];
    if (r) setHighlighted(r.target);
  };
  const onListSelect = (_item: ScrollableListItem, index: number) => {
    const r = rows[index];
    if (r) r.onSelect();
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <PriorityBadge tier={problem.priorityTier} />
        <Text> </Text>
        <LifecycleBadge status={problem.lifecycleStatus} />
        <Text bold> {problem.slug}</Text>
        <Text> — {problem.title}</Text>
      </Box>

      <Box>
        <Box flexDirection="column" width="50%" paddingRight={1}>
          {rows.length === 0 ? (
            <Empty label="no evidence, solutions, or decisions" />
          ) : (
            <ScrollableList items={listItems} onFocus={onListFocus} onSelect={onListSelect} />
          )}
        </Box>
        <Box
          flexDirection="column"
          width="50%"
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
        >
          <ProblemDetailPane target={highlighted} data={data} />
        </Box>
      </Box>

      <Footer
        hints={[
          ["↑↓", "nav"],
          ["↵", "open"],
          ["esc", "back"],
          ["q", "quit"],
        ]}
      />
    </Box>
  );
}

function ProblemDetailPane({
  target,
  data,
}: {
  target: ProblemTarget | null;
  data: ProblemDetail;
}): React.ReactElement {
  const { problem, evidence, solutions, latestDecision, eliminations, abandonment } = data;
  if (!target) {
    return (
      <Box flexDirection="column">
        <Text bold>Description</Text>
        <Text>{problem.description}</Text>
        {problem.description ? null : <Empty label="no description" />}
      </Box>
    );
  }
  if (target.kind === "evidence") {
    const e = evidence.find((x) => x.id === target.evidenceId);
    if (!e) return <Empty label="evidence missing" />;
    return (
      <Box flexDirection="column">
        <Text bold>Evidence {e.id}</Text>
        {e.note ? <Text>note: {e.note}</Text> : null}
        <SectionTitle>Observation</SectionTitle>
        {e.observation ? (
          <>
            <Box>
              <Text bold>{e.observation.id}</Text>
              <ArchivedTag archive={e.observation.archive} />
            </Box>
            <Text>{e.observation.content}</Text>
            {e.observation.source ? <Text color="gray">source: {e.observation.source}</Text> : null}
            {e.observation.sourceType ? (
              <Text color="gray">source_type: {e.observation.sourceType}</Text>
            ) : null}
            {e.observation.tags ? <Text color="gray">tags: {e.observation.tags}</Text> : null}
          </>
        ) : (
          <Empty label="observation missing" />
        )}
      </Box>
    );
  }
  if (target.kind === "solution") {
    const s = solutions.find((x) => x.id === target.solutionId);
    if (!s) return <Empty label="solution missing" />;
    return (
      <Box flexDirection="column">
        <Box>
          <SolutionStatusBadge status={s.status} />
          <Text bold> {s.slug}</Text>
        </Box>
        <Text>{s.title}</Text>
        {s.description ? (
          <Box marginTop={1}>
            <Text>{s.description}</Text>
          </Box>
        ) : null}
        {s.effort ? <Text color="gray">effort: {s.effort}</Text> : null}
        {s.originatingIdeaId ? <Text color="gray">from idea: {s.originatingIdeaId}</Text> : null}
      </Box>
    );
  }
  if (target.kind === "decision") {
    if (!latestDecision) return <Empty label="no decision" />;
    return (
      <Box flexDirection="column">
        <Text bold>Decision {latestDecision.id}</Text>
        <Text>
          chosen: <Text color="green">{latestDecision.chosenSolutionId}</Text>
        </Text>
        {latestDecision.rejectedSolutionIds.length > 0 ? (
          <Text>
            rejected: <Text color="red">{latestDecision.rejectedSolutionIds.join(", ")}</Text>
          </Text>
        ) : null}
        <SectionTitle>Rationale</SectionTitle>
        <Text>{latestDecision.rationale}</Text>
        {latestDecision.context ? (
          <>
            <SectionTitle>Context</SectionTitle>
            <Text>{latestDecision.context}</Text>
          </>
        ) : null}
      </Box>
    );
  }
  if (target.kind === "elimination") {
    const e = eliminations.find((x) => x.id === target.eliminationId);
    if (!e) return <Empty label="elimination missing" />;
    return (
      <Box flexDirection="column">
        <Text bold>Elimination {e.id}</Text>
        <Text>ruled out: {e.eliminatedSolutionIds.join(", ") || "(none)"}</Text>
        <SectionTitle>Rationale</SectionTitle>
        <Text>{e.rationale}</Text>
        {e.context ? (
          <>
            <SectionTitle>Context</SectionTitle>
            <Text>{e.context}</Text>
          </>
        ) : null}
      </Box>
    );
  }
  if (target.kind === "abandonment") {
    if (!abandonment) return <Empty label="no abandonment" />;
    return (
      <Box flexDirection="column">
        <Text bold>Abandonment {abandonment.id}</Text>
        <SectionTitle>Rationale</SectionTitle>
        <Text>{abandonment.rationale}</Text>
      </Box>
    );
  }
  if (target.kind === "outcome") {
    const s = solutions.find((x) => x.id === target.solutionId);
    const o = s?.outcome;
    if (!o) return <Empty label="no outcome" />;
    return (
      <Box flexDirection="column">
        <Text bold>Outcome {o.id}</Text>
        <Text color="gray">for solution: {s!.slug}</Text>
        <SectionTitle>Observed impact</SectionTitle>
        <Text>{o.observedImpact}</Text>
        {o.expectedImpact ? (
          <>
            <SectionTitle>Expected impact</SectionTitle>
            <Text>{o.expectedImpact}</Text>
          </>
        ) : null}
        {o.learnings ? (
          <>
            <SectionTitle>Learnings</SectionTitle>
            <Text>{o.learnings}</Text>
          </>
        ) : null}
        {o.followUpProblemIds.length > 0 ? (
          <>
            <SectionTitle>Follow-up problems</SectionTitle>
            <Text>{o.followUpProblemIds.join(", ")}</Text>
          </>
        ) : null}
      </Box>
    );
  }
  return <Empty label="unknown target" />;
}

// ---------- Solution detail ----------

export function SolutionDetailView({ solutionId }: { solutionId: string }): React.ReactElement {
  const [data, setData] = useState<SolutionDetail | null>(null);

  useEffect(() => {
    getSolutionDetail(solutionId).then(setData);
  }, [solutionId]);

  if (!data) return <Text color="gray">loading solution…</Text>;

  const { solution, problem, choosingDecision, rejectingDecision, eliminatedBy, outcome } = data;

  return (
    <Box flexDirection="column">
      <Box>
        <SolutionStatusBadge status={solution.status} />
        <Text bold> {solution.slug}</Text>
        <Text> — {solution.title}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color="gray">
          problem: {problem.slug} ({problem.lifecycleStatus})
        </Text>
      </Box>
      {solution.description ? (
        <Box marginTop={1}>
          <Text>{solution.description}</Text>
        </Box>
      ) : null}
      {solution.effort ? <Text color="gray">effort: {solution.effort}</Text> : null}
      {solution.originatingIdeaId ? (
        <Text color="gray">from idea: {solution.originatingIdeaId}</Text>
      ) : null}

      {choosingDecision ? (
        <>
          <SectionTitle>Chosen by {choosingDecision.id}</SectionTitle>
          <Text>{choosingDecision.rationale}</Text>
          {choosingDecision.context ? <Text color="gray">{choosingDecision.context}</Text> : null}
          {choosingDecision.rejectedSolutionIds.length > 0 ? (
            <Text color="gray">
              also rejected: {choosingDecision.rejectedSolutionIds.join(", ")}
            </Text>
          ) : null}
        </>
      ) : null}

      {rejectingDecision && rejectingDecision.id !== choosingDecision?.id ? (
        <>
          <SectionTitle>Rejected by {rejectingDecision.id}</SectionTitle>
          <Text>{rejectingDecision.rationale}</Text>
          {rejectingDecision.context ? <Text color="gray">{rejectingDecision.context}</Text> : null}
          <Text color="gray">chose: {rejectingDecision.chosenSolutionId}</Text>
        </>
      ) : null}

      {eliminatedBy.length > 0 ? (
        <>
          <SectionTitle>Eliminated</SectionTitle>
          {eliminatedBy.map((e) => (
            <Box key={e.id} flexDirection="column" marginBottom={1}>
              <Text color="red" bold>
                {e.id}
              </Text>
              <Text>{e.rationale}</Text>
              {e.context ? <Text color="gray">{e.context}</Text> : null}
            </Box>
          ))}
        </>
      ) : null}

      {outcome ? (
        <>
          <SectionTitle>Outcome {outcome.id}</SectionTitle>
          <Text>observed: {outcome.observedImpact}</Text>
          {outcome.expectedImpact ? <Text>expected: {outcome.expectedImpact}</Text> : null}
          {outcome.learnings ? <Text>learnings: {outcome.learnings}</Text> : null}
          {outcome.followUpProblemIds.length > 0 ? (
            <Text color="gray">follow-ups: {outcome.followUpProblemIds.join(", ")}</Text>
          ) : null}
        </>
      ) : null}

      {!choosingDecision && !rejectingDecision && eliminatedBy.length === 0 && !outcome ? (
        <Box marginTop={1}>
          <Empty label="no decision, elimination, or outcome yet" />
        </Box>
      ) : null}

      <Footer
        hints={[
          ["esc", "back"],
          ["q", "quit"],
        ]}
      />
    </Box>
  );
}

// ---------- Observation detail ----------

export function ObservationDetailView({
  observationId,
}: {
  observationId: string;
}): React.ReactElement {
  const [data, setData] = useState<ObservationDetail | null>(null);

  useEffect(() => {
    getObservationDetail(observationId).then(setData);
  }, [observationId]);

  if (!data) return <Text color="gray">loading observation…</Text>;

  const { observation, evidenceLinks } = data;

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>{observation.id}</Text>
        <ArchivedTag archive={observation.archive} />
      </Box>
      <Box marginTop={1}>
        <Text>{observation.content}</Text>
      </Box>
      {observation.source ? <Text color="gray">source: {observation.source}</Text> : null}
      {observation.sourceType ? (
        <Text color="gray">source_type: {observation.sourceType}</Text>
      ) : null}
      {observation.tags ? <Text color="gray">tags: {observation.tags}</Text> : null}

      <SectionTitle>Linked problems ({evidenceLinks.length})</SectionTitle>
      {evidenceLinks.length === 0 ? (
        <Empty label="not linked to any Problem as Evidence" />
      ) : (
        evidenceLinks.map((e) => (
          <Box key={e.id} flexDirection="column" marginBottom={1}>
            <Box>
              <LifecycleBadge status={e.problem.lifecycleStatus} />
              <Text bold> {e.problem.slug}</Text>
              <Text> {e.problem.title}</Text>
            </Box>
            {e.note ? <Text color="gray">note: {e.note}</Text> : null}
          </Box>
        ))
      )}

      <Footer
        hints={[
          ["esc", "back"],
          ["q", "quit"],
        ]}
      />
    </Box>
  );
}

// ---------- Intake queue ----------

export function IntakeQueueView({
  workstream,
  showArchived,
  onOpenObservation,
}: {
  workstream: Workstream;
  showArchived: boolean;
  onOpenObservation: (observationId: string) => void;
}): React.ReactElement {
  const [rows, setRows] = useState<Observation[] | null>(null);

  useEffect(() => {
    listUnlinkedObservations(workstream.id, showArchived).then(setRows);
  }, [workstream.id, showArchived]);

  if (!rows) return <Text color="gray">loading intake…</Text>;

  return (
    <Box flexDirection="column">
      <Text bold>
        Intake queue — {workstream.slug}
        {showArchived ? "  (show-archived)" : ""}
      </Text>
      {rows.length === 0 ? (
        <Box marginTop={1}>
          <Empty label="no unlinked observations" />
        </Box>
      ) : (
        <SelectInput
          items={rows.map((o) => ({
            key: o.id,
            label: `${o.id.padEnd(10)} ${o.archive ? "[archived] " : ""}${truncate(o.content, 80)}`,
            value: o.id,
          }))}
          onSelect={(item) => onOpenObservation(item.value)}
          limit={25}
        />
      )}
      {showArchived ? (
        <Box flexDirection="column" marginTop={1}>
          {rows
            .filter((o) => o.archive)
            .map((o) => (
              <Text key={o.id} color="gray">
                {o.id} archived: {o.archive?.rationale ?? "(no rationale)"}
              </Text>
            ))}
        </Box>
      ) : null}
      <Footer
        hints={[
          ["↑↓", "nav"],
          ["↵", "open"],
          ["esc", "back"],
          ["a", showArchived ? "hide archived" : "show archived"],
          ["q", "quit"],
        ]}
      />
    </Box>
  );
}

// ---------- Ideas queue ----------

export function IdeasQueueView({
  workstream,
  showArchived,
}: {
  workstream: Workstream;
  showArchived: boolean;
}): React.ReactElement {
  const [rows, setRows] = useState<Idea[] | null>(null);

  useEffect(() => {
    listUnpromotedIdeas(workstream.id, showArchived).then(setRows);
  }, [workstream.id, showArchived]);

  if (!rows) return <Text color="gray">loading ideas…</Text>;

  return (
    <Box flexDirection="column">
      <Text bold>
        Ideas queue — {workstream.slug}
        {showArchived ? "  (show-archived)" : ""}
      </Text>
      {rows.length === 0 ? (
        <Box marginTop={1}>
          <Empty label="no unpromoted ideas" />
        </Box>
      ) : (
        rows.map((i) => (
          <Box key={i.id} flexDirection="column" marginTop={1}>
            <Box>
              <Text bold>{i.slug}</Text>
              <ArchivedTag archive={i.archive} />
            </Box>
            <Text>{i.title}</Text>
            {i.description ? <Text color="gray">{truncate(i.description, 160)}</Text> : null}
            {i.hypothesizedProblemArea ? (
              <Text color="gray">problem area: {i.hypothesizedProblemArea}</Text>
            ) : null}
          </Box>
        ))
      )}
      <Footer
        hints={[
          ["esc", "back"],
          ["a", showArchived ? "hide archived" : "show archived"],
          ["q", "quit"],
        ]}
      />
    </Box>
  );
}
