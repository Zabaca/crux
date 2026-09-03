/**
 * The roadmap board — @dnd-kit, carried over from the Next.js app as an island
 * (ADR-0004). The drag mechanics, the optimistic move and the rollback-on-reject
 * are the same code; what changed is where it dispatches (`/v1/dispatch` rather
 * than a Next.js server action), how it refreshes (a full reload on the DO's
 * push stream rather than `router.refresh()`), and its class names, which are
 * the Worker's stylesheet rather than Tailwind.
 *
 * This is the whole of `/w/<slug>`: it shows every Stage, including the two a
 * Problem can only leave by a transition of its own, so the page that reads
 * best is also the page you act on. A terminal lane is rendered and inert
 * rather than omitted — "there are fifteen done" is the fact a roadmap is read
 * for, and dropping into it is refused here rather than by the server.
 */
import { useEffect, useState } from "react";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

import { dispatchAction, onViewStateChange } from "../lib/dispatch.js";

/** Every Stage a Problem can be in — the four schedulable ones and the two terminal. */
export type Stage = "now" | "next" | "later" | "unscheduled" | "done" | "abandoned";

export type BoardProblem = {
  id: number;
  title: string;
  stage: Stage;
  evidenceCount: number;
  attemptCount: number;
  openAttemptCount: number;
};

/**
 * The lanes, in roadmap order. `movable` is the drag rule: `done` and
 * `abandoned` are reached by transitions that carry a reason — an Outcome, an
 * Abandonment — so they are shown but neither picked up from nor dropped into.
 * Anything else would be a drag that the server refuses.
 */
const STAGES: ReadonlyArray<{ id: Stage; label: string; movable: boolean }> = [
  { id: "now", label: "Now", movable: true },
  { id: "next", label: "Next", movable: true },
  { id: "later", label: "Later", movable: true },
  { id: "unscheduled", label: "Unscheduled", movable: true },
  { id: "done", label: "Done", movable: false },
  { id: "abandoned", label: "Abandoned", movable: false },
];

/** The Stages a drag may start or end in — `movable` above, as a lookup. */
const MOVABLE: ReadonlySet<Stage> = new Set(STAGES.filter((s) => s.movable).map((s) => s.id));

function Card({
  slug,
  problem,
  movable,
}: {
  slug: string;
  problem: BoardProblem;
  movable: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: String(problem.id),
    data: { stage: problem.stage },
    disabled: !movable,
  });
  return (
    <div
      ref={setNodeRef}
      className="pcard"
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.5 : 1,
        cursor: movable ? "grab" : "default",
      }}
      {...attributes}
      {...listeners}
    >
      <div className="id mono">PRB-{problem.id}</div>
      <a className="t" href={`/w/${slug}/problems/${problem.id}`}>
        {problem.title}
      </a>
      <div className="bar">
        <span className={`seg ${problem.evidenceCount > 0 ? "on" : ""}`} />
        <span className={`seg ${problem.attemptCount > 0 ? "on" : ""}`} />
        <span className={`seg ${problem.openAttemptCount > 0 ? "on g" : ""}`} />
      </div>
      <div className="mm">
        <span>{problem.evidenceCount} ev</span>
        <span>{problem.attemptCount} att</span>
        <span>{problem.openAttemptCount > 0 ? "in flight" : "idle"}</span>
      </div>
    </div>
  );
}

function Lane({
  stage,
  label,
  slug,
  problems,
  movable,
}: {
  stage: Stage;
  label: string;
  slug: string;
  problems: BoardProblem[];
  movable: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage, disabled: !movable });
  return (
    <div
      ref={setNodeRef}
      className={`lane ${stage}`}
      style={isOver ? { borderColor: "var(--now)" } : undefined}
    >
      <div className="lane-hd">
        <span className="dot" />
        <span className="nm">{label}</span>
        <span className="ct">{problems.length}</span>
      </div>
      {problems.length === 0 ? (
        <div className="lane-empty">Nothing here.</div>
      ) : (
        problems.map((p) => <Card key={p.id} slug={slug} problem={p} movable={movable} />)
      )}
    </div>
  );
}

export default function RoadmapBoard({
  slug,
  workstreamId,
  problems: initial,
}: {
  slug: string;
  /** Handed down rather than spelled `WS-${slug}` here: how a Workstream id is
   * built is core's rule, and the page has already read the row. */
  workstreamId: string;
  problems: BoardProblem[];
}) {
  const [problems, setProblems] = useState(initial);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Another session of this Member — a second tab, or `crux` in a terminal —
  // moves the same corpus. The DO tells us the revision changed; the page is
  // server-rendered, so re-reading it is the whole of the refresh.
  //
  // Filtered to this board's Workstream: agents work several in parallel, and a
  // reload triggered by work in a Workstream this page is not showing is
  // interruption, not freshness. The one thing this filter costs is a rename:
  // that frame names the *new* id, so a board left open on the old slug no
  // longer reloads into its 404. It was already showing a Workstream that had
  // moved out from under it.
  useEffect(() => onViewStateChange(() => location.reload(), { workstreamId }), [workstreamId]);

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const from = active.data.current?.stage as Stage | undefined;
    const to = over.id as Stage;
    if (!from || from === to) return;
    // dnd-kit already refuses to pick up or drop on a terminal lane. Saying it
    // again here is what keeps `dispatchAction`'s untyped payload honest: this
    // is the line that decides a Stage is legal, not the drop target's config.
    if (!MOVABLE.has(from) || !MOVABLE.has(to)) return;

    const id = Number(active.id);
    const before = problems;
    setError(null);
    setProblems(problems.map((p) => (p.id === id ? { ...p, stage: to } : p)));

    const res =
      to === "unscheduled"
        ? await dispatchAction("UNSCHEDULE_PROBLEM", { id })
        : await dispatchAction("SCHEDULE_PROBLEM", { id, stage: to });

    if (!res.ok) {
      // The server refused the transition, so the card did not move. Put it
      // back and say why — a card that quietly snaps back teaches nothing.
      setProblems(before);
      setError({ code: res.code, message: res.message });
    }
  }

  return (
    <>
      {error ? (
        <p className="notice bad">
          <span className="mono">{error.code}</span> — {error.message}
        </p>
      ) : null}
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="board">
          {STAGES.map((s) => (
            <Lane
              key={s.id}
              stage={s.id}
              label={s.label}
              slug={slug}
              movable={s.movable}
              problems={problems.filter((p) => p.stage === s.id)}
            />
          ))}
        </div>
      </DndContext>
    </>
  );
}
