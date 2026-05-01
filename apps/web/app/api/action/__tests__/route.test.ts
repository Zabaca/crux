import { describe, test, expect, mock, beforeEach } from "bun:test";

const dispatchMock = mock(async (_action: unknown, _opts: unknown) => ({
  revision: 1,
  result: { ok: true, id: "WS-test" },
}));

class FakeActionNotAllowedError extends Error {
  code = "ACTION_NOT_ALLOWED" as const;
  allowedView: string[] = ["SELECT_WORKSTREAM"];
  allowedMutation: string[] = ["ADD_WORKSTREAM"];
  globals: string[] = ["BACK"];
  constructor() {
    super("nope");
    this.name = "ActionNotAllowedError";
  }
}

const { ActionSchema } = await import("@crux/core/actions/schemas");

mock.module("@crux/core/actions", () => ({
  dispatch: dispatchMock,
  ActionNotAllowedError: FakeActionNotAllowedError,
  ActionSchema,
}));

const { POST } = await import("../route.js");

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/action", () => {
  beforeEach(() => {
    dispatchMock.mockClear();
  });

  test("400 when payload fails Zod parse", async () => {
    const res = await POST(makeReq({ kind: "BOGUS_ACTION" }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: false; code: string };
    expect(json.ok).toBe(false);
    expect(json.code).toBe("INVALID_PAYLOAD");
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  test("400 when body is not JSON", async () => {
    const req = new Request("http://localhost/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("403 when dispatch throws ActionNotAllowedError, includes allowed list", async () => {
    dispatchMock.mockImplementationOnce(async () => {
      throw new FakeActionNotAllowedError();
    });
    const res = await POST(
      makeReq({
        kind: "ADD_WORKSTREAM",
        payload: { slug: "x", title: "X" },
      }),
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as { ok: false; code: string; allowed: string[] };
    expect(json.code).toBe("ACTION_NOT_ALLOWED");
    expect(json.allowed).toContain("ADD_WORKSTREAM");
  });

  test("200 happy path returns revision + result", async () => {
    const res = await POST(
      makeReq({
        kind: "ADD_WORKSTREAM",
        payload: { slug: "x", title: "X" },
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: true; revision: number };
    expect(json.ok).toBe(true);
    expect(json.revision).toBe(1);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    const call = dispatchMock.mock.calls[0]!;
    expect((call[1] as { enforceAllow?: boolean }).enforceAllow).toBe(true);
  });

  test("500 when dispatch throws generic error", async () => {
    dispatchMock.mockImplementationOnce(async () => {
      throw new Error("db gone");
    });
    const res = await POST(
      makeReq({
        kind: "ADD_WORKSTREAM",
        payload: { slug: "x", title: "X" },
      }),
    );
    expect(res.status).toBe(500);
    const json = (await res.json()) as { code: string; message: string };
    expect(json.code).toBe("TRANSITION_ERROR");
    expect(json.message).toBe("db gone");
  });
});
