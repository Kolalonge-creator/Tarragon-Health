const rpc = jest.fn();
const notificationInsert = jest.fn().mockResolvedValue({ error: null });
const requestRow = { organisation_id: "22222222-2222-4222-8222-222222222222", patient_id: "33333333-3333-4333-8333-333333333333" };

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({ rpc: (...args: unknown[]) => rpc(...args) }),
}));
// The notification target is read with the service role: a doctor with no care-team tie cannot read the row under their own RLS.
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) =>
      table === "notifications"
        ? { insert: (row: unknown) => notificationInsert(row) }
        : { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: requestRow }) }) }) },
  }),
}));

import { answerSecondOpinionRequest, readSharedResults } from "./actions";
import { secondOpinionAnswerSchema, SECOND_OPINION_SPECIALIST_TYPES } from "@/lib/validation/second-opinion";

const id = "11111111-1111-4111-8111-111111111111";
const form = (entries: Record<string, string>): FormData => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};
const answer = { request_id: id, answer: "Your results look consistent with the earlier diagnosis." };

beforeEach(() => {
  rpc.mockReset();
  notificationInsert.mockClear();
});

describe("answerSecondOpinionRequest", () => {
  it("answers without a referral and sends no referral arguments", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const result = await answerSecondOpinionRequest(undefined, form(answer));
    expect(result?.message).toMatch(/Answer sent/);
    expect(rpc).toHaveBeenCalledWith("answer_second_opinion_request", { p_request: id, p_answer: answer.answer });
    expect(notificationInsert).toHaveBeenCalledTimes(1);
  });

  it("recommends a referral when ticked, with the specialty, urgency and reason", async () => {
    rpc.mockResolvedValue({ data: "44444444-4444-4444-8444-444444444444", error: null });
    const result = await answerSecondOpinionRequest(
      undefined,
      form({ ...answer, refer: "on", specialist_type: "cardiology", urgency: "priority", referral_reason: "Raised troponin on the outside report." }),
    );
    expect(result?.message).toMatch(/accept the referral/);
    expect(rpc).toHaveBeenCalledWith(
      "answer_second_opinion_request",
      expect.objectContaining({ p_specialist_type: "cardiology", p_urgency: "priority", p_reason: "Raised troponin on the outside report." }),
    );
  });

  it("refuses a ticked referral with no reason before calling the database", async () => {
    const result = await answerSecondOpinionRequest(
      undefined,
      form({ ...answer, refer: "on", specialist_type: "cardiology", urgency: "routine", referral_reason: "short" }),
    );
    expect(result?.error).toMatch(/reason/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a specialty that is not in the list", async () => {
    const result = await answerSecondOpinionRequest(
      undefined,
      form({ ...answer, refer: "on", specialist_type: "astrology", urgency: "routine", referral_reason: "A long enough reason." }),
    );
    expect(result?.error).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a non-doctor to plain words and does not notify the patient", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "x" } });
    const result = await answerSecondOpinionRequest(undefined, form(answer));
    expect(result?.error).toMatch(/active doctor/);
    expect(notificationInsert).not.toHaveBeenCalled();
  });
});

describe("readSharedResults", () => {
  it("returns not found for anything that is not a request id, without calling the database", async () => {
    expect((await readSharedResults("nope")).error).toMatch(/not found/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("hides the database's reason when access is refused", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "request not found" } });
    expect((await readSharedResults(id)).error).toBe("Request not found.");
  });

  it("parses the audited read", async () => {
    rpc.mockResolvedValue({
      data: {
        id,
        patient_id: requestRow.patient_id,
        status: "submitted",
        existing_diagnosis_or_result: "Told my HbA1c was high",
        source_description: null,
        specific_question: null,
        results: [
          {
            id: "55555555-5555-4555-8555-555555555555",
            panel_code: "membership_annual",
            received_at: "2026-10-01T10:00:00Z",
            items: [{ analyte_code: "hba1c", value_numeric: 7.1, value_text: null, unit: "%", ref_low: 4, ref_high: 5.6, flag: "high" }],
          },
        ],
      },
      error: null,
    });
    const r = await readSharedResults(id);
    expect(r.data?.results[0].items[0].analyte_code).toBe("hba1c");
  });
});

describe("specialty list", () => {
  it("accepts every listed specialty in the answer schema", () => {
    for (const t of SECOND_OPINION_SPECIALIST_TYPES) {
      expect(
        secondOpinionAnswerSchema.safeParse({ requestId: id, answer: "A long enough answer.", referral: { specialistType: t, urgency: "routine", reason: "A long enough reason." } }).success,
      ).toBe(true);
    }
  });
});
