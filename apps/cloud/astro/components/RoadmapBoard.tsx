/**
 * The roadmap board — @dnd-kit, carried over from the Next.js app as an island
 * (ADR-0004). The drag mechanics, the optimistic move and the rollback-on-reject
 * are the same code; what changed is where it dispatches (`/v1/dispatch` rather
 * than a Next.js server action), how it refreshes (a full reload on the DO's
 * push stream rather than `router.refresh()`), and its class names, which are
 * the Worker's stylesheet rather than Tailwind.
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

export type Stage = "now" | "next" | "later" | "unscheduled";

export type BoardProblem = {
  id: number;
  title: string;
  stage: Stage;
  evidenceCount: number;
  solutionCount: number;
  decided: boolean;
};

/** The four Stages a Problem can be dragged between. `done` and `abandoned` are
 * transitions with their own rules, not columns you can drop into. */
const STAGES: ReadonlyArray<{ id: Stage; label: string }> = [
  { id: "now", label: "Now" },
  { id: "next", label: "Next" },
  { id: "later", label: "Later" },
  { id: "unscheduled", label: "Unscheduled" },
];

function Card({ slug, problem }: { slug: string; problem: BoardProblem }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: String(problem.id),
    data: { stage: problem.stage },
  });
  return (
    <div
      ref={setNodeRef}
      className="pcard"
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.5 : 1,
        cursor: "grab",
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
        <span className={`seg ${problem.solutionCount > 0 ? "on" : ""}`} />
        <span className={`seg ${problem.decided ? "on g" : ""}`} />
      </div>
    </div>
  );
}

function Lane({
  stage,
  label,
  slug,
  problems,
}: {
  stage: Stage;
  label: string;
  slug: string;
  problems: BoardProblem[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
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
        problems.map((p) => <Card key={p.id} slug={slug} problem={p} />)
      )}
    </div>
  );
}

export default function RoadmapBoard({
  slug,
  problems: initial,
}: {
  slug: string;
  problems: BoardProblem[];
}) {
  const [problems, setProblems] = useState(initial);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Another session of this Member — a second tab, or `crux` in a terminal —
  // moves the same corpus. The DO tells us the revision changed; the page is
  // server-rendered, so re-reading it is the whole of the refresh.
  useEffect(() => onViewStateChange(() => location.reload()), []);

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const from = active.data.current?.stage as Stage | undefined;
    const to = over.id as Stage;
    if (!from || from === to) return;

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
        <div className="board" style={{ gridTemplateColumns: "repeat(4,minmax(0,1fr))" }}>
          {STAGES.map((s) => (
            <Lane
              key={s.id}
              stage={s.id}
              label={s.label}
              slug={slug}
              problems={problems.filter((p) => p.stage === s.id)}
            />
          ))}
        </div>
      </DndContext>
    </>
  );
}
