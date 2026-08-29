import { describe, expect, it } from "@jest/globals";
import { createSupportTicketSchema, escalateTicketSchema, ticketSatisfactionSchema } from "./support-tickets";

describe("createSupportTicketSchema", () => {
  it("accepts a real category with a real subject/description", () => {
    const result = createSupportTicketSchema.safeParse({
      category: "appointment",
      subject: "Cannot reschedule",
      description: "The reschedule button does nothing when I tap it.",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown category", () => {
    const result = createSupportTicketSchema.safeParse({
      category: "billing",
      subject: "Cannot reschedule",
      description: "The reschedule button does nothing when I tap it.",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a description that's too short to be useful", () => {
    const result = createSupportTicketSchema.safeParse({
      category: "technical",
      subject: "Broken",
      description: "Help",
    });
    expect(result.success).toBe(false);
  });
});

describe("ticketSatisfactionSchema", () => {
  it("rejects a score outside 1-5", () => {
    const result = ticketSatisfactionSchema.safeParse({ ticket_id: "00000000-0000-4000-8000-000000000001", satisfaction_score: 6 });
    expect(result.success).toBe(false);
  });

  it("accepts a score of 5 with no comment", () => {
    const result = ticketSatisfactionSchema.safeParse({ ticket_id: "00000000-0000-4000-8000-000000000001", satisfaction_score: 5 });
    expect(result.success).toBe(true);
  });
});

describe("escalateTicketSchema", () => {
  it("requires a real explanation, not a one-word note", () => {
    const result = escalateTicketSchema.safeParse({ ticket_id: "00000000-0000-4000-8000-000000000001", note: "hmm" });
    expect(result.success).toBe(false);
  });
});
