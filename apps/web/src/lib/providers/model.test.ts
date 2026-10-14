import { describe, expect, it } from "@jest/globals";
import { BREAK_LABEL, breakRowSchema, canReplay, closeStatusSchema, describeProviderError, healthRowSchema, healthTone, inboxRowSchema, inboxTone, reasonSchema } from "./model";

const ID = "6f1d7a2e-3b44-4c8e-9a51-0c2d1e8f7a10";

describe("provider board model", () => {
  it("parses a health row, a break row and an inbox row, and refuses an unknown state", () => {
    expect(healthRowSchema.safeParse({ provider: "paystack", operation: "initialize", state: "open", consecutive_failures: 5, opened_at: null, last_failure_at: null, last_success_at: null, last_error_code: "timeout", status: "down" }).success).toBe(true);
    expect(healthRowSchema.safeParse({ provider: "paystack", operation: "x", state: "weird", consecutive_failures: 1, opened_at: null, last_failure_at: null, last_success_at: null, last_error_code: null, status: "down" }).success).toBe(false);
    const b = { id: ID, break_type: "amount_mismatch", provider_reference: "chg-1", provider_amount_kobo: 650000, ledger_amount_kobo: 700000, difference_kobo: -50000, detail: null, status: "open", first_seen_at: "2026-10-13T10:00:00Z", last_seen_at: "2026-10-13T10:00:00Z", age_hours: 3, ageing_bucket: "under_24h", closing_note: null };
    expect(breakRowSchema.safeParse(b).success).toBe(true);
    expect(breakRowSchema.safeParse({ ...b, provider_amount_kobo: 650000.5 }).success).toBe(false); // money is whole kobo
    expect(Object.keys(BREAK_LABEL)).toHaveLength(5);
    const e = { id: ID, provider: "zoom", event_type: "meeting.ended", idempotency_key: "k", signature_verified: true, status: "failed", attempt_count: 1, delivery_count: 1, replay_count: 0, last_error: "x", linked_entity_type: null, linked_entity_id: null, received_at: "2026-10-13T10:00:00Z", processed_at: null };
    expect(inboxRowSchema.safeParse(e).success).toBe(true);
    expect(inboxRowSchema.safeParse({ ...e, provider: "stripe" }).success).toBe(false);
    expect("raw_body" in inboxRowSchema.shape).toBe(false);
  });

  it("tones: dead is red, a rejected signature is grey, healthy is green", () => {
    expect(inboxTone("dead")).toBe("red");
    expect(inboxTone("rejected")).toBe("grey");
    expect(inboxTone("processed")).toBe("green");
    expect(inboxTone("failed")).toBe("amber");
    expect(inboxTone("received")).toBe("amber");
    expect(inboxTone("processing")).toBe("blue");
    expect(healthTone("healthy")).toBe("green");
    expect(healthTone("degraded")).toBe("amber");
    expect(healthTone("down")).toBe("red");
  });

  it("an unverified, rejected or in-flight event never offers replay", () => {
    expect(canReplay({ signature_verified: true, status: "processed" })).toBe(true);
    expect(canReplay({ signature_verified: true, status: "dead" })).toBe(true);
    expect(canReplay({ signature_verified: false, status: "rejected" })).toBe(false);
    expect(canReplay({ signature_verified: true, status: "processing" })).toBe(false);
    expect(canReplay({ signature_verified: false, status: "received" })).toBe(false);
  });

  it("plain words for known errors, a safe fallback for the rest, and a note must say something", () => {
    expect(describeProviderError("provider_event_unverified_never_replayed")).toContain("never be replayed");
    expect(describeProviderError("provider_event_in_flight")).toContain("right now");
    expect(describeProviderError("weird")).toBe("Something went wrong. Nothing was changed.");
    expect(describeProviderError(null, "x")).toBe("x");
    expect(reasonSchema.safeParse("short").success).toBe(false);
    expect(reasonSchema.safeParse("a real reason here").success).toBe(true);
    expect(closeStatusSchema.safeParse("deleted").success).toBe(false);
  });
});
