/** @jest-environment jsdom */
/**
 * Regression coverage for the handoff state machine extracted out of
 * ai-coach-chat.tsx and ask-tarragon-card.tsx (see this file's own header
 * comment for why -- ask-tarragon-card.tsx's hand-copied version had
 * already dropped the error state's "message your care team directly"
 * fallback link before this extraction, per /code-review high on PR #767).
 */
import { act, renderHook } from "@testing-library/react";
import { useCareTeamHandoff } from "./use-care-team-handoff";
import { requestCareTeamHandoffAction } from "./handoff-actions";

jest.mock("./handoff-actions", () => ({
  requestCareTeamHandoffAction: jest.fn(),
}));

const mockedAction = requestCareTeamHandoffAction as jest.MockedFunction<
  typeof requestCareTeamHandoffAction
>;

describe("useCareTeamHandoff", () => {
  beforeEach(() => {
    mockedAction.mockReset();
  });

  it("starts idle and passes the given conversationId through to the action", async () => {
    mockedAction.mockResolvedValue({ success: true, threadId: "thread-1" });
    const { result } = renderHook(() => useCareTeamHandoff("conv-1"));
    expect(result.current.handoff).toEqual({ status: "idle" });

    await act(async () => {
      await result.current.requestHandoff();
    });

    expect(mockedAction).toHaveBeenCalledWith("conv-1");
    expect(result.current.handoff).toEqual({ status: "done" });
  });

  it("moves to pending immediately, then done on success", async () => {
    let resolveAction: (value: { success: true; threadId: string }) => void;
    mockedAction.mockReturnValue(
      new Promise((resolve) => {
        resolveAction = resolve;
      })
    );
    const { result } = renderHook(() => useCareTeamHandoff(undefined));

    let pendingPromise: Promise<void>;
    act(() => {
      pendingPromise = result.current.requestHandoff();
    });
    expect(result.current.handoff).toEqual({ status: "pending" });

    await act(async () => {
      resolveAction({ success: true, threadId: "thread-2" });
      await pendingPromise;
    });
    expect(result.current.handoff).toEqual({ status: "done" });
  });

  it("carries the real error message through on failure", async () => {
    mockedAction.mockResolvedValue({
      success: false,
      error: "Could not start a conversation with your care team",
    });
    const { result } = renderHook(() => useCareTeamHandoff("conv-1"));

    await act(async () => {
      await result.current.requestHandoff();
    });

    expect(result.current.handoff).toEqual({
      status: "error",
      error: "Could not start a conversation with your care team",
    });
  });
});
