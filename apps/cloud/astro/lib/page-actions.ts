/**
 * Which actions each page offers.
 *
 * This is a projection of the entity model, not a menu: the Problem page offers
 * exactly the mutations that take a Problem, with the Problem's own id fixed
 * into the payload, so a dialog cannot file a Solution against the wrong parent.
 * The server still decides whether any of them is legal — these specs shape the
 * request, they do not pre-approve it.
 */
import type { ActionSpec } from "../components/ActionBar.js";

/** `/w/<slug>/board` — the Workstream's own intake. */
export function workstreamActions(slug: string): ActionSpec[] {
  return [
    {
      kind: "ADD_PROBLEM",
      label: "File a Problem",
      fields: [
        { name: "workstream", fixed: slug, required: true },
        { name: "title", label: "Title", required: true },
        { name: "description", label: "Description", type: "textarea", required: true },
      ],
    },
    {
      kind: "ADD_OBSERVATION",
      label: "File an Observation",
      fields: [
        { name: "workstream", fixed: slug, required: true },
        { name: "content", label: "What you saw", type: "textarea", required: true },
        { name: "source", label: "Source" },
      ],
    },
  ];
}

/** `/w/<slug>/problems/<id>` — narrowing this Problem, and closing it. */
export function problemActions(
  problemId: number,
  solutions: Array<{ id: number; title: string }>,
): ActionSpec[] {
  const options = solutions.map((s) => ({ value: String(s.id), label: `${s.id} · ${s.title}` }));
  const problem = { name: "problem", fixed: String(problemId), required: true, asNumber: true };

  return [
    {
      kind: "ADD_SOLUTION",
      label: "Add a Solution",
      fields: [
        problem,
        { name: "title", label: "Title", required: true },
        { name: "description", label: "Description", type: "textarea" },
      ],
    },
    {
      kind: "ADD_EVIDENCE",
      label: "Link Evidence",
      fields: [
        problem,
        { name: "observation", label: "Observation id", required: true },
        { name: "note", label: "Why it counts", type: "textarea" },
      ],
    },
    {
      kind: "ADD_DECISION",
      label: "Record a Decision",
      fields: [
        problem,
        {
          name: "chosen",
          label: "Chosen Solution",
          type: "select",
          options,
          required: true,
          asNumber: true,
        },
        { name: "rationale", label: "Rationale", type: "textarea", required: true },
      ],
    },
    {
      kind: "ADD_ELIMINATION",
      label: "Eliminate a Solution",
      fields: [
        {
          name: "solutions",
          label: "Solution",
          type: "select",
          options,
          required: true,
          asNumber: true,
          asArray: true,
        },
        { name: "rationale", label: "Rationale", type: "textarea", required: true },
      ],
    },
    {
      kind: "SHIP_SOLUTION",
      label: "Ship a Solution",
      fields: [
        {
          name: "id",
          label: "Solution",
          type: "select",
          options,
          required: true,
          asNumber: true,
        },
      ],
    },
    {
      kind: "MARK_PROBLEM_DONE",
      label: "Mark done",
      fields: [{ name: "id", fixed: String(problemId), required: true, asNumber: true }],
    },
    {
      kind: "ABANDON_PROBLEM",
      label: "Abandon",
      fields: [
        { name: "id", fixed: String(problemId), required: true, asNumber: true },
        { name: "rationale", label: "Why give up", type: "textarea", required: true },
      ],
    },
  ];
}
