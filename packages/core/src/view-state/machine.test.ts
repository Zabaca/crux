import { describe, expect, test } from "bun:test";
import { createActor } from "xstate";
import { viewMachine } from "./machine.js";

function actorWith(guards: { ws?: boolean; prob?: boolean } = {}) {
  const m = viewMachine.provide({
    guards: {
      workstreamExists: () => guards.ws ?? true,
      problemExistsInWorkstream: () => guards.prob ?? true,
    },
  });
  const a = createActor(m);
  a.start();
  return a;
}

describe("view machine", () => {
  test("initial state is viewing.workstream_list", () => {
    const a = actorWith();
    expect(a.getSnapshot().value).toEqual({ viewing: "workstream_list" });
    expect(a.getSnapshot().context).toEqual({ workstreamSlug: null, problemSlug: null });
  });

  test("SELECT_WORKSTREAM with guard=true goes to dashboard and sets slug", () => {
    const a = actorWith({ ws: true });
    a.send({ type: "SELECT_WORKSTREAM", slug: "crux" });
    expect(a.getSnapshot().value).toEqual({ viewing: "workstream_dashboard" });
    expect(a.getSnapshot().context.workstreamSlug).toBe("crux");
  });

  test("SELECT_WORKSTREAM with guard=false is refused", () => {
    const a = actorWith({ ws: false });
    const before = a.getSnapshot();
    a.send({ type: "SELECT_WORKSTREAM", slug: "nope" });
    expect(a.getSnapshot().value).toEqual(before.value);
    expect(a.getSnapshot().context.workstreamSlug).toBeNull();
  });

  test("OPEN_PROBLEM from dashboard sets both slugs", () => {
    const a = actorWith({ ws: true, prob: true });
    a.send({ type: "SELECT_WORKSTREAM", slug: "crux" });
    a.send({ type: "OPEN_PROBLEM", slug: "foo" });
    expect(a.getSnapshot().value).toEqual({ viewing: "problem_detail" });
    expect(a.getSnapshot().context).toEqual({
      workstreamSlug: "crux",
      problemSlug: "foo",
    });
  });

  test("BACK from problem_detail preserves workstream, clears problem", () => {
    const a = actorWith({ ws: true, prob: true });
    a.send({ type: "SELECT_WORKSTREAM", slug: "crux" });
    a.send({ type: "OPEN_PROBLEM", slug: "foo" });
    a.send({ type: "BACK" });
    expect(a.getSnapshot().value).toEqual({ viewing: "workstream_dashboard" });
    expect(a.getSnapshot().context).toEqual({
      workstreamSlug: "crux",
      problemSlug: null,
    });
  });

  test("BACK from workstream_dashboard clears context", () => {
    const a = actorWith({ ws: true });
    a.send({ type: "SELECT_WORKSTREAM", slug: "crux" });
    a.send({ type: "BACK" });
    expect(a.getSnapshot().value).toEqual({ viewing: "workstream_list" });
    expect(a.getSnapshot().context).toEqual({
      workstreamSlug: null,
      problemSlug: null,
    });
  });

  test("persisted snapshot round-trips through JSON", () => {
    const a = actorWith({ ws: true });
    a.send({ type: "SELECT_WORKSTREAM", slug: "crux" });
    const persisted = a.getPersistedSnapshot();
    const roundTripped = JSON.parse(JSON.stringify(persisted));
    const b = createActor(viewMachine, { snapshot: roundTripped });
    b.start();
    expect(b.getSnapshot().value).toEqual({ viewing: "workstream_dashboard" });
    expect(b.getSnapshot().context.workstreamSlug).toBe("crux");
  });

  test("illegal event is a no-op (no throw)", () => {
    const a = actorWith();
    const before = a.getSnapshot().value;
    // BACK is not legal from workstream_list (no parent target)
    a.send({ type: "BACK" });
    expect(a.getSnapshot().value).toEqual(before);
  });

  test("OPEN_PROBLEM is global: jumps from problem_detail to a new problem", () => {
    const a = actorWith({ ws: true, prob: true });
    a.send({ type: "SELECT_WORKSTREAM", slug: "crux" });
    a.send({ type: "OPEN_PROBLEM", slug: "p1" });
    expect(a.getSnapshot().value).toEqual({ viewing: "problem_detail" });
    expect(a.getSnapshot().context.problemSlug).toBe("p1");
    a.send({ type: "OPEN_PROBLEM", slug: "p2" });
    expect(a.getSnapshot().value).toEqual({ viewing: "problem_detail" });
    expect(a.getSnapshot().context.problemSlug).toBe("p2");
  });

  test("SELECT_INTAKE rejected when no workstream selected", () => {
    const a = actorWith();
    a.send({ type: "SELECT_INTAKE" });
    expect(a.getSnapshot().value).toEqual({ viewing: "workstream_list" });
  });
});
