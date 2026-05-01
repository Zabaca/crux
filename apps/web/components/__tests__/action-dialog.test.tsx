import { describe, test, expect, mock, beforeEach } from "bun:test";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";

const dispatchMock = mock(async (_kind: string, _payload: unknown) => ({
  ok: true,
  revision: 1,
  result: null,
}));

mock.module("@/lib/dispatch-action", () => ({
  dispatchAction: dispatchMock,
}));

const { ActionDialog } = await import("../action-dialog.js");

describe("ActionDialog", () => {
  beforeEach(() => {
    cleanup();
    dispatchMock.mockReset();
    dispatchMock.mockImplementation(async () => ({ ok: true, revision: 1, result: null }));
    // happy-dom may not implement <dialog> showModal — stub it.
    if (!HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = function () {
        this.setAttribute("open", "");
      };
    }
    if (!HTMLDialogElement.prototype.close) {
      HTMLDialogElement.prototype.close = function () {
        this.removeAttribute("open");
      };
    }
  });

  test("submits payload and calls onClose on 200 response", async () => {
    const onClose = mock(() => {});
    const { getByRole, getByLabelText } = render(
      <ActionDialog
        kind="ADD_WORKSTREAM"
        title="Add"
        fields={[
          { name: "slug", required: true },
          { name: "title", required: true },
        ]}
        open={true}
        onClose={onClose}
      />,
    );
    fireEvent.change(getByLabelText(/slug/i), { target: { value: "x" } });
    fireEvent.change(getByLabelText(/title/i), { target: { value: "X" } });
    fireEvent.submit(getByRole("button", { name: /submit/i }).closest("form")!);
    await waitFor(() => expect(dispatchMock).toHaveBeenCalledTimes(1));
    expect(dispatchMock).toHaveBeenCalledWith("ADD_WORKSTREAM", { slug: "x", title: "X" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  test("renders allowed list on 403 response", async () => {
    dispatchMock.mockImplementationOnce(async () => ({
      ok: false,
      code: "ACTION_NOT_ALLOWED",
      message: "nope",
      allowed: ["ADD_WORKSTREAM", "BACK"],
    }));
    const onClose = mock(() => {});
    const { container, findByText, getByLabelText } = render(
      <ActionDialog
        kind="ADD_PROBLEM"
        title="Add"
        fields={[{ name: "slug", required: true }]}
        open={true}
        onClose={onClose}
      />,
    );
    fireEvent.change(getByLabelText(/slug/i), { target: { value: "x" } });
    const form = container.querySelector("form")!;
    fireEvent.submit(form);
    await waitFor(() => expect(dispatchMock).toHaveBeenCalled());
    expect(await findByText("ACTION_NOT_ALLOWED")).toBeTruthy();
    expect(await findByText("ADD_WORKSTREAM")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
