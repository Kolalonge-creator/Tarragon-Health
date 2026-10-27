/**
 * Records request actions: input is validated before the database is asked, the letter version and reply period come from versioned configuration
 * (never from the caller), a refusal from the database maps to a calm result, and nothing is ever treated as saved when it was not.
 */
const rpc = jest.fn();
const getCurrentUser = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: (...args: unknown[]) => rpc(...args) }),
  getCurrentUser: () => getCurrentUser(),
}));
const revalidatePath = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

import { loadLetterConfig } from "@/lib/records-request/letter";
import {
  createRecordsRequestAction,
  markRecordsRequestReceivedAction,
  markRecordsRequestSentAction,
  setRecordsRequestNoteAction,
  withdrawRecordsRequestAction,
} from "./actions";

const ID = "0b8f6d0e-3c1a-4f3e-9a52-1d6f6a9f7c11";

beforeEach(() => {
  rpc.mockReset();
  revalidatePath.mockReset();
  getCurrentUser.mockReset();
  getCurrentUser.mockResolvedValue({ id: "u1" });
});

describe("createRecordsRequestAction", () => {
  it("sends the configured letter version, trims empties to null, and returns the new id", async () => {
    rpc.mockResolvedValue({ data: { id: ID }, error: null });
    const r = await createRecordsRequestAction({ facility: " Lagos General ", contact: "", scope: ["lab_results"], note: "" });
    expect(r).toEqual({ ok: true, id: ID });
    expect(rpc).toHaveBeenCalledWith("create_records_request", {
      p_facility: "Lagos General",
      p_contact: null,
      p_scope: ["lab_results"],
      p_letter_version: loadLetterConfig().letterVersionKey,
      p_note: null,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/patient/records-requests");
  });

  it("refuses bad input without asking the database", async () => {
    for (const bad of [
      { facility: "x", scope: ["lab_results"] },
      { facility: "Lagos General", scope: [] },
      { facility: "Lagos General", scope: ["mental_health"] },
      { facility: "Lagos General", scope: ["lab_results"], note: "x".repeat(501) },
    ]) {
      await expect(createRecordsRequestAction(bad)).resolves.toEqual({ ok: false, error: "invalid" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses without a signed-in user", async () => {
    getCurrentUser.mockResolvedValue(null);
    await expect(createRecordsRequestAction({ facility: "Lagos General", scope: ["lab_results"] })).resolves.toEqual({ ok: false, error: "not_signed_in" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps the database's guard refusal to not_open and any other failure to failed, never to success", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "55000", message: "not open" } });
    await expect(createRecordsRequestAction({ facility: "Lagos General", scope: ["lab_results"] })).resolves.toEqual({ ok: false, error: "not_open" });
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    await expect(createRecordsRequestAction({ facility: "Lagos General", scope: ["lab_results"] })).resolves.toEqual({ ok: false, error: "failed" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("the state actions", () => {
  it("hand over takes the reply period from configuration, not from the caller", async () => {
    rpc.mockResolvedValue({ data: { id: ID }, error: null });
    await expect(markRecordsRequestSentAction(ID)).resolves.toEqual({ ok: true, id: ID });
    expect(rpc).toHaveBeenCalledWith("mark_records_request_sent", { p_id: ID, p_response_days: loadLetterConfig().responseDays });
  });

  it("received and withdraw call their functions with the id only", async () => {
    rpc.mockResolvedValue({ data: { id: ID }, error: null });
    await markRecordsRequestReceivedAction(ID);
    await withdrawRecordsRequestAction(ID);
    expect(rpc).toHaveBeenCalledWith("mark_records_request_received", { p_id: ID });
    expect(rpc).toHaveBeenCalledWith("withdraw_records_request", { p_id: ID });
  });

  it("a request that is not the person's, or is in the wrong state, is not_found", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "nope" } });
    await expect(markRecordsRequestReceivedAction(ID)).resolves.toEqual({ ok: false, error: "not_found" });
  });

  it("rejects an id that is not a uuid before asking the database", async () => {
    await expect(markRecordsRequestSentAction("nope")).resolves.toEqual({ ok: false, error: "invalid" });
    await expect(withdrawRecordsRequestAction("nope")).resolves.toEqual({ ok: false, error: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a note is length-limited and an empty note clears it", async () => {
    await expect(setRecordsRequestNoteAction({ id: ID, note: "x".repeat(501) })).resolves.toEqual({ ok: false, error: "invalid" });
    rpc.mockResolvedValue({ data: { id: ID }, error: null });
    await setRecordsRequestNoteAction({ id: ID, note: "" });
    expect(rpc).toHaveBeenCalledWith("set_records_request_note", { p_id: ID, p_note: null });
  });
});
