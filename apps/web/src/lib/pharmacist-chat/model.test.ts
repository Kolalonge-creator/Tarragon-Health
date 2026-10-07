import { chatErrorKind, pharmacistMessagesSchema, patientThreadsSchema, validMessage, validTopic, MAX_MESSAGE_LENGTH } from "./model";

describe("pharmacist chat model", () => {
  it("trims and bounds what a screen may send, like the database", () => {
    expect(validMessage("  hello  ")).toBe("hello");
    expect(validMessage("   ")).toBeNull();
    expect(validMessage("x".repeat(MAX_MESSAGE_LENGTH))).not.toBeNull();
    expect(validMessage("x".repeat(MAX_MESSAGE_LENGTH + 1))).toBeNull();
    expect(validTopic("Question about my tablets")).toBe("Question about my tablets");
    expect(validTopic("")).toBeNull();
    expect(validTopic("x".repeat(121))).toBeNull();
  });

  it("explains the three known database refusals and treats anything else as a plain failure", () => {
    expect(chatErrorKind("thread_closed")).toBe("closed");
    expect(chatErrorKind("too_many_messages")).toBe("too_many");
    expect(chatErrorKind("pharmacy_not_available")).toBe("not_available");
    expect(chatErrorKind("boom")).toBe("failed");
    expect(chatErrorKind(undefined)).toBe("failed");
  });

  it("a malformed answer fails the parse rather than reading as an empty list", () => {
    expect(patientThreadsSchema.safeParse([{ thread_id: "nope" }]).success).toBe(false);
    expect(pharmacistMessagesSchema.safeParse("x").success).toBe(false);
  });

  it("the pharmacist's message shape carries a first name and one medicine, nothing else about the patient", () => {
    const keys = Object.keys(pharmacistMessagesSchema.element.shape).sort();
    expect(keys).toEqual(["body", "created_at", "dose", "medicine", "message_id", "patient_first_name", "possible_emergency", "sender_role"]);
  });
});
