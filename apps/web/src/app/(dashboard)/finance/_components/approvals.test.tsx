/** @jest-environment jsdom */
/**
 * reject() used `note[id] ?? window.prompt(...) ?? ""`, so once a reviewer
 * typed into the note field and then cleared it, note[id] was "" (not
 * undefined/null) and `??` never fell through to the prompt — the Reject
 * button silently did nothing: no prompt, no setBusy/setMsg, no request.
 * This proves a cleared note still opens the prompt, and that declining the
 * prompt (or leaving it blank) now surfaces a visible message instead of a
 * silent no-op.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApprovalsQueue } from "./approvals";

const invalidateQueries = jest.fn();
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

const PENDING = [
  {
    id: "req-1",
    request_type: "manual_journal" as const,
    payload: { currency: "NGN", memo: "Test entry", lines: [] },
    reason: null,
    requested_by_name: "Ada",
    requested_at: "2026-01-01T00:00:00Z",
    is_own_request: false,
  },
];

jest.mock("@/lib/finance/queries", () => ({
  usePendingApprovals: () => ({ data: PENDING, isLoading: false }),
  useApprovalHistory: () => ({ data: [], isLoading: false }),
  financeKeys: { all: ["finance"] },
}));

const approveRequestAction = jest.fn();
const rejectRequestAction = jest.fn();
jest.mock("@/lib/finance/actions", () => ({
  approveRequestAction: (...args: unknown[]) => approveRequestAction(...args),
  rejectRequestAction: (...args: unknown[]) => rejectRequestAction(...args),
}));

describe("ApprovalsQueue — reject() with an empty note", () => {
  beforeEach(() => {
    invalidateQueries.mockReset();
    approveRequestAction.mockReset();
    rejectRequestAction.mockReset();
    rejectRequestAction.mockResolvedValue({ ok: true });
  });

  it("still opens the prompt after the note field is typed into and cleared", async () => {
    const promptSpy = jest.spyOn(window, "prompt").mockReturnValue("Duplicate entry");
    render(<ApprovalsQueue />);

    const noteInput = screen.getByPlaceholderText("Optional note");
    fireEvent.change(noteInput, { target: { value: "something" } });
    fireEvent.change(noteInput, { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    expect(promptSpy).toHaveBeenCalledWith("Reason for rejecting?");
    expect(rejectRequestAction).toHaveBeenCalledWith("req-1", "Duplicate entry");
    await waitFor(() => expect(screen.getByText("Rejected.")).toBeTruthy());
    promptSpy.mockRestore();
  });

  it("shows a visible message instead of doing nothing when the prompt is declined", async () => {
    const promptSpy = jest.spyOn(window, "prompt").mockReturnValue(null);
    render(<ApprovalsQueue />);

    const noteInput = screen.getByPlaceholderText("Optional note");
    fireEvent.change(noteInput, { target: { value: "something" } });
    fireEvent.change(noteInput, { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    expect(await screen.findByText("Rejection needs a reason: nothing was rejected.")).toBeTruthy();
    expect(rejectRequestAction).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it("treats a whitespace-only prompt answer as no reason too", async () => {
    const promptSpy = jest.spyOn(window, "prompt").mockReturnValue("   ");
    render(<ApprovalsQueue />);

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    expect(await screen.findByText("Rejection needs a reason: nothing was rejected.")).toBeTruthy();
    expect(rejectRequestAction).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it("uses a non-empty note field directly without prompting", async () => {
    const promptSpy = jest.spyOn(window, "prompt");
    render(<ApprovalsQueue />);

    fireEvent.change(screen.getByPlaceholderText("Optional note"), {
      target: { value: "Wrong account coded" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    expect(promptSpy).not.toHaveBeenCalled();
    expect(rejectRequestAction).toHaveBeenCalledWith("req-1", "Wrong account coded");
    await waitFor(() => expect(screen.getByText("Rejected.")).toBeTruthy());
    promptSpy.mockRestore();
  });
});
