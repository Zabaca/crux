import { z } from "zod";
import { setup, assign } from "xstate";

const SelectWorkstreamEvent = z.object({ type: z.literal("SELECT_WORKSTREAM"), slug: z.string() });
const OpenProblemEvent = z.object({ type: z.literal("OPEN_PROBLEM"), slug: z.string() });
const SelectIntakeEvent = z.object({ type: z.literal("SELECT_INTAKE") });
const SelectIdeasEvent = z.object({ type: z.literal("SELECT_IDEAS") });
const BackEvent = z.object({ type: z.literal("BACK") });

export const ViewEventSchema = z.discriminatedUnion("type", [
  SelectWorkstreamEvent,
  OpenProblemEvent,
  SelectIntakeEvent,
  SelectIdeasEvent,
  BackEvent,
]);

export type ViewEvent = z.infer<typeof ViewEventSchema>;

export type ViewContext = {
  workstreamSlug: string | null;
  problemSlug: string | null;
};

// Keyed by ViewEvent["type"] so TypeScript errors if a new event is added
// to the schema above without updating this map.
export const VIEW_EVENT_PAYLOAD_HINTS: Record<ViewEvent["type"], Record<string, string> | null> = {
  SELECT_WORKSTREAM: { slug: "string" },
  OPEN_PROBLEM: { slug: "string" },
  SELECT_INTAKE: null,
  SELECT_IDEAS: null,
  BACK: null,
};

export const viewMachine = setup({
  types: {
    context: {} as ViewContext,
    events: {} as ViewEvent,
  },
  guards: {
    // Overridden at use-site via machine.provide({ guards }).
    workstreamExists: (_args: { context: ViewContext; event: ViewEvent }) => false,
    problemExistsInWorkstream: (_args: { context: ViewContext; event: ViewEvent }) => false,
  },
  actions: {
    setWorkstream: assign({
      workstreamSlug: ({ event }) => (event.type === "SELECT_WORKSTREAM" ? event.slug : null),
      problemSlug: () => null,
    }),
    setProblem: assign({
      problemSlug: ({ event }) => (event.type === "OPEN_PROBLEM" ? event.slug : null),
    }),
    clearProblem: assign({
      problemSlug: () => null,
    }),
    clearAll: assign({
      workstreamSlug: () => null,
      problemSlug: () => null,
    }),
  },
}).createMachine({
  id: "view",
  initial: "viewing",
  context: {
    workstreamSlug: null,
    problemSlug: null,
  },
  states: {
    viewing: {
      initial: "workstream_list",
      states: {
        workstream_list: {
          on: {
            SELECT_WORKSTREAM: {
              target: "workstream_dashboard",
              guard: "workstreamExists",
              actions: "setWorkstream",
            },
          },
        },
        workstream_dashboard: {
          on: {
            OPEN_PROBLEM: {
              target: "problem_detail",
              guard: "problemExistsInWorkstream",
              actions: "setProblem",
            },
            SELECT_INTAKE: { target: "intake_queue" },
            SELECT_IDEAS: { target: "ideas_queue" },
            BACK: {
              target: "workstream_list",
              actions: "clearAll",
            },
          },
        },
        problem_detail: {
          on: {
            BACK: {
              target: "workstream_dashboard",
              actions: "clearProblem",
            },
          },
        },
        intake_queue: {
          on: {
            BACK: { target: "workstream_dashboard" },
          },
        },
        ideas_queue: {
          on: {
            BACK: { target: "workstream_dashboard" },
          },
        },
      },
    },
  },
});

export type ViewMachine = typeof viewMachine;
