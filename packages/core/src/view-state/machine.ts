import { setup, assign } from "xstate";

/**
 * Machine-based view control bus.
 *
 * The machine is the single source of view truth for both surfaces (TUI + web).
 * It's pure (no IO). Transitions are gated by guards that validate against the
 * live db; the guards are provided at the call site (see persistence.ts) so the
 * machine stays side-effect-free.
 *
 * Defaults for guards are fail-closed (`() => false`), so if someone forgets
 * to wire db-backed guards they'll see refusals rather than silent corruption.
 */

export type ViewContext = {
  workstreamSlug: string | null;
  problemSlug: string | null;
};

export type ViewEvent =
  | { type: "SELECT_WORKSTREAM"; slug: string }
  | { type: "OPEN_PROBLEM"; slug: string }
  | { type: "BACK" };

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
      },
    },
  },
});

export type ViewMachine = typeof viewMachine;
