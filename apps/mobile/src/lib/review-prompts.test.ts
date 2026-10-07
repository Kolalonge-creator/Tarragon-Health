/**
 * checkForPendingReviewPrompt() is the mobile half of the Reputation &
 * Review-Generation Engine — CLAUDE.md's own guardrail for this feature is
 * "never a blanket rate-us popup", so the two failure modes that matter most
 * here are: (1) calling the native review prompt when nothing was actually
 * claimed, and (2) claiming a prompt (which the DB marks 'shown' the instant
 * it's claimed, unrecoverably) without ever actually asking. See
 * private.claim_pending_reputation_review_prompt in
 * supabase/migrations/20260924211014_reputation_review_prompts.sql.
 */
import * as StoreReview from "expo-store-review";
import { supabase } from "@/lib/supabase";
import { checkForPendingReviewPrompt } from "./review-prompts";

jest.mock("@/lib/supabase", () => ({ supabase: { rpc: jest.fn() } }));
jest.mock("expo-store-review", () => ({
  isAvailableAsync: jest.fn(),
  requestReview: jest.fn(),
}));

const mockRpc = supabase.rpc as unknown as jest.Mock;
const mockIsAvailable = StoreReview.isAvailableAsync as jest.MockedFunction<typeof StoreReview.isAvailableAsync>;
const mockRequestReview = StoreReview.requestReview as jest.MockedFunction<typeof StoreReview.requestReview>;

describe("checkForPendingReviewPrompt", () => {
  it("asks when a prompt was actually claimed", async () => {
    mockIsAvailable.mockResolvedValue(true);
    mockRpc.mockResolvedValue({ data: { id: "prompt-1", status: "shown" }, error: null });

    await checkForPendingReviewPrompt();

    expect(mockRequestReview).toHaveBeenCalledTimes(1);
  });

  it("never asks when the RPC claimed nothing, even though the response object is truthy", async () => {
    // private.claim_pending_reputation_review_prompt returns SQL NULL for
    // the composite type when nothing matches; Postgres/PostgREST expand
    // that into a row of all-null fields rather than a JSON `null` — this
    // is the exact shape a real "nothing to claim" response takes, and a
    // bare `!data` check would incorrectly treat it as a claimed prompt.
    mockIsAvailable.mockResolvedValue(true);
    mockRpc.mockResolvedValue({
      data: {
        id: null, organisation_id: null, patient_id: null, trigger_event: null,
        source_table: null, source_id: null, channel: null, status: null,
        queued_at: null, sent_at: null, shown_at: null, clicked_at: null,
        dismissed_at: null, created_at: null,
      },
      error: null,
    });

    await checkForPendingReviewPrompt();

    expect(mockRequestReview).not.toHaveBeenCalled();
  });

  it("never claims a prompt when the native review API isn't available", async () => {
    // Checked before the RPC call, deliberately: claiming marks the prompt
    // 'shown' the instant it's claimed (it can't be re-queued), so claiming
    // first and finding out afterward that requestReview() isn't callable
    // would burn the patient's one ask without ever actually asking them.
    mockIsAvailable.mockResolvedValue(false);

    await checkForPendingReviewPrompt();

    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockRequestReview).not.toHaveBeenCalled();
  });

  it("does not ask when the RPC call errors", async () => {
    mockIsAvailable.mockResolvedValue(true);
    mockRpc.mockResolvedValue({ data: null, error: { message: "network error" } });

    await checkForPendingReviewPrompt();

    expect(mockRequestReview).not.toHaveBeenCalled();
  });

  it("is a harmless no-op on a thrown error — never surfaces to the caller", async () => {
    mockIsAvailable.mockRejectedValue(new Error("unsupported platform"));
    await expect(checkForPendingReviewPrompt()).resolves.toBeUndefined();

    mockIsAvailable.mockResolvedValue(true);
    mockRpc.mockRejectedValue(new Error("network down"));
    await expect(checkForPendingReviewPrompt()).resolves.toBeUndefined();

    mockRpc.mockResolvedValue({ data: { id: "prompt-2" }, error: null });
    mockRequestReview.mockRejectedValue(new Error("store review failed"));
    await expect(checkForPendingReviewPrompt()).resolves.toBeUndefined();
  });
});
