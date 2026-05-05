"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { ProblemCard, type ProblemRow } from "./problem-card";
import { useViewSync } from "./sync-view-state";
import { dispatchAction } from "@/lib/dispatch-action";

type Tier = "now" | "next" | "later" | "unscheduled";
type Columns = Record<Tier, ProblemRow[]>;

const TIERS: { id: Tier; title: string; tone: string }[] = [
  { id: "now", title: "Now", tone: "text-red-600" },
  { id: "next", title: "Next", tone: "text-orange-600" },
  { id: "later", title: "Later", tone: "text-stone-600" },
  { id: "unscheduled", title: "Unscheduled", tone: "text-slate-500" },
];

function DraggableCard({ slug, p, tier }: { slug: string; p: ProblemRow; tier: Tier }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: p.slug,
    data: { tier },
  });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.5 : 1,
      }}
      {...attributes}
      {...listeners}
    >
      <ProblemCard slug={slug} p={p} />
    </div>
  );
}

function DroppableColumn({
  tier,
  title,
  tone,
  rows,
  workstreamSlug,
}: {
  tier: Tier;
  title: string;
  tone: string;
  rows: ProblemRow[];
  workstreamSlug: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: tier });
  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col gap-2 min-w-0 rounded p-1 transition-colors ${
        isOver ? "bg-accent/50" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <h3 className={`text-xs font-semibold uppercase tracking-wide ${tone}`}>{title}</h3>
        <span className="text-xs text-muted-foreground">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div className="text-xs text-muted-foreground italic min-h-[2rem]">empty</div>
      ) : (
        <ul className="space-y-2">
          {rows.map((p) => (
            <li key={p.id}>
              <DraggableCard slug={workstreamSlug} p={p} tier={tier} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RoadmapBoard({
  workstreamSlug,
  columns: initial,
}: {
  workstreamSlug: string;
  columns: Columns;
}) {
  const router = useRouter();
  const { ensureSynced } = useViewSync();
  const [columns, setColumns] = useState<Columns>(initial);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over) return;
    const from = (active.data.current?.tier as Tier | undefined) ?? null;
    const to = over.id as Tier;
    if (!from || from === to) return;

    const slug = String(active.id);
    const card = columns[from].find((c) => c.slug === slug);
    if (!card) return;

    const prev = columns;
    const moved: ProblemRow = {
      ...card,
      status: to === "unscheduled" ? null : to,
    };
    setColumns({
      ...columns,
      [from]: columns[from].filter((c) => c.slug !== slug),
      [to]: [moved, ...columns[to]],
    });

    try {
      await ensureSynced();
    } catch (err) {
      setColumns(prev);
      alert(`View sync failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    const res =
      to === "unscheduled"
        ? await dispatchAction("UNSCHEDULE_PROBLEM", { slug })
        : await dispatchAction("SCHEDULE_PROBLEM", { slug, tier: to });

    if (!res.ok) {
      setColumns(prev);
      alert(`Move failed: ${res.message}`);
      return;
    }
    router.refresh();
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {TIERS.map((t) => (
          <DroppableColumn
            key={t.id}
            tier={t.id}
            title={t.title}
            tone={t.tone}
            rows={columns[t.id]}
            workstreamSlug={workstreamSlug}
          />
        ))}
      </div>
    </DndContext>
  );
}
