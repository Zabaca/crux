"use client";

import { useState } from "react";
import { getAllowedActions } from "@crux/core/actions/allowed";
import { ActionDialog, type FieldSpec } from "./action-dialog";

type ViewLeaf =
  | "workstream_list"
  | "workstream_dashboard"
  | "problem_detail"
  | "intake_queue"
  | "ideas_queue";

type Context = {
  workstreamSlug?: string | null;
  problemSlug?: string | null;
};

type Spec = {
  kind: string;
  label: string;
  title: string;
  fields: (ctx: Context) => FieldSpec[];
};

const SPECS: Spec[] = [
  {
    kind: "ADD_WORKSTREAM",
    label: "Add workstream",
    title: "Add workstream",
    fields: () => [
      { name: "slug", required: true },
      { name: "title", required: true },
      { name: "description", type: "textarea" },
    ],
  },
  {
    kind: "ADD_PROBLEM",
    label: "Add problem",
    title: "Add problem",
    fields: (ctx) => [
      { name: "workstream", hidden: true, defaultValue: ctx.workstreamSlug ?? "" },
      { name: "slug", required: true },
      { name: "title", required: true },
      { name: "description", type: "textarea", required: true },
    ],
  },
  {
    kind: "ADD_THEME",
    label: "Add theme",
    title: "Add theme",
    fields: (ctx) => [
      { name: "workstream", hidden: true, defaultValue: ctx.workstreamSlug ?? "" },
      { name: "slug", required: true },
      { name: "title", required: true },
    ],
  },
  {
    kind: "ADD_OBSERVATION",
    label: "Add observation",
    title: "Add observation",
    fields: (ctx) => [
      { name: "workstream", hidden: true, defaultValue: ctx.workstreamSlug ?? "" },
      { name: "content", type: "textarea", required: true },
      { name: "source", label: "source (optional)" },
    ],
  },
  {
    kind: "ADD_IDEA",
    label: "Add idea",
    title: "Add idea",
    fields: (ctx) => [
      { name: "workstream", hidden: true, defaultValue: ctx.workstreamSlug ?? "" },
      { name: "slug", required: true },
      { name: "title", required: true },
      { name: "description", type: "textarea" },
    ],
  },
  {
    kind: "ADD_SOLUTION",
    label: "Add solution",
    title: "Add solution",
    fields: (ctx) => [
      { name: "problem", hidden: true, defaultValue: ctx.problemSlug ?? "" },
      { name: "slug", required: true },
      { name: "title", required: true },
      { name: "description", type: "textarea" },
    ],
  },
  {
    kind: "ADD_EVIDENCE",
    label: "Add evidence",
    title: "Link observation as evidence",
    fields: (ctx) => [
      { name: "problem", hidden: true, defaultValue: ctx.problemSlug ?? "" },
      { name: "observation", label: "observation id (e.g. OBS-001)", required: true },
      { name: "note", type: "textarea" },
    ],
  },
  {
    kind: "ADD_DECISION",
    label: "Record decision",
    title: "Record decision",
    fields: (ctx) => [
      { name: "problem", hidden: true, defaultValue: ctx.problemSlug ?? "" },
      { name: "chosen", label: "chosen solution slug", required: true },
      { name: "rationale", type: "textarea", required: true },
      { name: "rejected", label: "rejected slugs (comma-separated)" },
    ],
  },
  {
    kind: "ADD_ELIMINATION",
    label: "Eliminate solution",
    title: "Eliminate solution",
    fields: () => [
      { name: "solution", label: "solution slug", required: true },
      { name: "rationale", type: "textarea", required: true },
    ],
  },
  {
    kind: "ADD_OUTCOME",
    label: "Record outcome",
    title: "Record outcome",
    fields: () => [
      { name: "solution", label: "solution slug", required: true },
      { name: "summary", type: "textarea", required: true },
    ],
  },
  {
    kind: "SCHEDULE_PROBLEM",
    label: "Schedule",
    title: "Schedule problem",
    fields: (ctx) => [
      { name: "slug", hidden: true, defaultValue: ctx.problemSlug ?? "" },
      { name: "tier", label: "tier (now|next|later)", required: true },
    ],
  },
  {
    kind: "UNSCHEDULE_PROBLEM",
    label: "Unschedule",
    title: "Unschedule problem",
    fields: (ctx) => [{ name: "slug", hidden: true, defaultValue: ctx.problemSlug ?? "" }],
  },
  {
    kind: "MARK_PROBLEM_DONE",
    label: "Mark done",
    title: "Mark problem done",
    fields: (ctx) => [{ name: "slug", hidden: true, defaultValue: ctx.problemSlug ?? "" }],
  },
  {
    kind: "ABANDON_PROBLEM",
    label: "Abandon",
    title: "Abandon problem",
    fields: (ctx) => [
      { name: "slug", hidden: true, defaultValue: ctx.problemSlug ?? "" },
      { name: "rationale", type: "textarea", required: true },
    ],
  },
  {
    kind: "SHIP_SOLUTION",
    label: "Ship solution",
    title: "Ship solution",
    fields: () => [{ name: "slug", label: "solution slug", required: true }],
  },
  {
    kind: "PROMOTE_IDEA",
    label: "Promote idea",
    title: "Promote idea to solution",
    fields: (ctx) => [
      { name: "workstream", hidden: true, defaultValue: ctx.workstreamSlug ?? "" },
      { name: "slug", label: "idea slug", required: true },
      {
        name: "problem",
        label: "problem slug",
        required: true,
        defaultValue: ctx.problemSlug ?? "",
      },
      { name: "title", required: true },
    ],
  },
  {
    kind: "ARCHIVE_OBSERVATION",
    label: "Archive observation",
    title: "Archive observation",
    fields: () => [{ name: "id", label: "observation id (e.g. OBS-001)", required: true }],
  },
  {
    kind: "ARCHIVE_IDEA",
    label: "Archive idea",
    title: "Archive idea",
    fields: () => [{ name: "slug", label: "idea slug", required: true }],
  },
  {
    kind: "RENAME_WORKSTREAM",
    label: "Rename workstream",
    title: "Rename workstream",
    fields: (ctx) => [
      { name: "oldSlug", hidden: true, defaultValue: ctx.workstreamSlug ?? "" },
      { name: "newSlug", required: true },
      { name: "title" },
      { name: "description", type: "textarea" },
    ],
  },
  {
    kind: "RENAME_PROBLEM",
    label: "Rename problem",
    title: "Rename problem",
    fields: (ctx) => [
      { name: "oldSlug", hidden: true, defaultValue: ctx.problemSlug ?? "" },
      { name: "newSlug", required: true },
      { name: "title" },
      { name: "description", type: "textarea" },
    ],
  },
  {
    kind: "RENAME_IDEA",
    label: "Rename idea",
    title: "Rename idea",
    fields: () => [
      { name: "oldSlug", required: true },
      { name: "newSlug", required: true },
      { name: "title" },
      { name: "description", type: "textarea" },
    ],
  },
  {
    kind: "RENAME_THEME",
    label: "Rename theme",
    title: "Rename theme",
    fields: () => [
      { name: "oldSlug", required: true },
      { name: "newSlug", required: true },
      { name: "title" },
      { name: "description", type: "textarea" },
    ],
  },
];

const SPECS_BY_KIND = new Map(SPECS.map((s) => [s.kind, s]));

export function MutationToolbar({ view, context = {} }: { view: ViewLeaf; context?: Context }) {
  const [openKind, setOpenKind] = useState<string | null>(null);
  const allowed = getAllowedActions({ viewing: view });
  const kinds = [...new Set([...allowed.allowedMutation, ...allowed.globals])].filter((k) =>
    SPECS_BY_KIND.has(k),
  );

  const spec = openKind ? SPECS_BY_KIND.get(openKind) : null;

  return (
    <div className="flex flex-wrap gap-2">
      {kinds.map((k) => {
        const s = SPECS_BY_KIND.get(k);
        if (!s) return null;
        return (
          <button
            key={k}
            type="button"
            onClick={() => setOpenKind(k)}
            className="rounded border px-2 py-1 text-xs hover:bg-accent"
          >
            {s.label}
          </button>
        );
      })}
      {spec ? (
        <ActionDialog
          kind={spec.kind}
          title={spec.title}
          fields={spec.fields(context)}
          open={true}
          onClose={() => setOpenKind(null)}
          transform={
            spec.kind === "ADD_DECISION"
              ? (vals) => ({
                  problem: vals.problem,
                  chosen: vals.chosen,
                  rationale: vals.rationale,
                  rejected: vals.rejected
                    ? vals.rejected
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean)
                    : undefined,
                })
              : undefined
          }
        />
      ) : null}
    </div>
  );
}
