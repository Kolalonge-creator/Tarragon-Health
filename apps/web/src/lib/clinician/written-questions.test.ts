import {
  answerWrittenQuestionSchema,
  claimRedirectPath,
  describeRpcError,
  handbackSchema,
  queueNextResultSchema,
} from "./written-questions";
import { decideReleaseSchema, respondCorrectionSchema } from "./note-requests";

const id = "11111111-1111-4111-8111-111111111111";

describe("answerWrittenQuestionSchema", () => {
  const base = { consultId: id, kind: "guidance", body: "Rest and drink water; call us if it gets worse.", attested: true };
  it("accepts a complete reply", () => {
    expect(answerWrittenQuestionSchema.safeParse(base).success).toBe(true);
  });
  it("refuses a reply without the attestation", () => {
    const r = answerWrittenQuestionSchema.safeParse({ ...base, attested: false });
    expect(r.success).toBe(false);
  });
  it("has no diagnosis field and strips one if sent", () => {
    const r = answerWrittenQuestionSchema.safeParse({ ...base, diagnosis: "x" });
    expect(r.success && "diagnosis" in r.data).toBe(false);
  });
  it("refuses an unknown kind and a short body", () => {
    expect(answerWrittenQuestionSchema.safeParse({ ...base, kind: "diagnosis" }).success).toBe(false);
    expect(answerWrittenQuestionSchema.safeParse({ ...base, body: "short" }).success).toBe(false);
  });
});

describe("handbackSchema", () => {
  it("needs a note for 'other'", () => {
    expect(handbackSchema.safeParse({ taskId: id, reason: "other" }).success).toBe(false);
    expect(handbackSchema.safeParse({ taskId: id, reason: "other", note: "Not a fit for me today." }).success).toBe(true);
    expect(handbackSchema.safeParse({ taskId: id, reason: "outside_competence" }).success).toBe(true);
  });
  it("refuses an unknown reason", () => {
    expect(handbackSchema.safeParse({ taskId: id, reason: "bored" }).success).toBe(false);
  });
});

describe("note request schemas", () => {
  it("withholding needs a reason of 10 characters, releasing does not", () => {
    expect(decideReleaseSchema.safeParse({ noteId: id, release: false, reason: "no" }).success).toBe(false);
    expect(decideReleaseSchema.safeParse({ noteId: id, release: false, reason: "Contains third party details." }).success).toBe(true);
    expect(decideReleaseSchema.safeParse({ noteId: id, release: true }).success).toBe(true);
  });
  it("a correction response is required", () => {
    expect(respondCorrectionSchema.safeParse({ requestId: id, outcome: "declined", response: "" }).success).toBe(false);
    expect(respondCorrectionSchema.safeParse({ requestId: id, outcome: "maybe", response: "Long enough text." }).success).toBe(false);
  });
});

describe("describeRpcError", () => {
  it("names the CMO-only release plainly", () => {
    expect(describeRpcError({ message: "note_release_cmo_only", code: "42501" })).toBe(
      "This note is protected. Only the Chief Medical Officer can release it.",
    );
  });
  it("maps a lost claim and never leaks raw SQL text", () => {
    expect(describeRpcError({ message: "queue_no_claim" })).toMatch(/no longer hold/);
    expect(describeRpcError({ message: "relation \"x\" does not exist" })).toBe("Something went wrong. Please try again.");
  });
});

describe("claimRedirectPath", () => {
  const base = "/clinician/async-consults";
  it("keeps a written question on the list", () => {
    const r = queueNextResultSchema.parse({ already_claimed: false, task: { id, type: "async_question" } });
    expect(claimRedirectPath(r, base)).toBe(base);
  });
  it("never drops another task type: it goes to the held notice", () => {
    const r = queueNextResultSchema.parse({ already_claimed: false, task: { id, type: "triage_review" } });
    expect(claimRedirectPath(r, base)).toBe(`${base}?held=${id}&type=triage_review`);
  });
  it("says so when nothing is eligible", () => {
    const r = queueNextResultSchema.parse({ already_claimed: false, task: null, reason: "none_eligible" });
    expect(claimRedirectPath(r, base)).toBe(`${base}?none=1`);
  });
});
