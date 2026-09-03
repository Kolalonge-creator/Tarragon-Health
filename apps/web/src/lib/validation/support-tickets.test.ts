import { describe, expect, it } from "@jest/globals";
import { createSupportTicketSchema, escalateTicketSchema, supportTicketCategorySchema, ticketSatisfactionSchema } from "./support-tickets";

describe("supportTicketCategorySchema", () => {
  it("accepts technical, the only category support_tickets carries", () => {
    expect(supportTicketCategorySchema.safeParse("technical").success).toBe(true);
  });

  it("rejects a category that belongs to navigation_requests instead (module 75)", () => {
    expect(supportTicketCategorySchema.safeParse("appointment").success).toBe(false);
  });
});

describe("createSupportTicketSchema", () => {
  it("accepts a real subject/description (category is server-assigned, never client input)", () => {
    const result = createSupportTicketSchema.safeParse({
      subject: "App crashes on login",
      description: "The app closes immediately after I enter my password.",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a description that's too short to be useful", () => {
    const result = createSupportTicketSchema.safeParse({
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
