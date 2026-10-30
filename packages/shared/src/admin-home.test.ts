import { describe, expect, it } from "@jest/globals";
import { attentionView, dependenciesDown, type AttentionItem, type AttentionKey } from "./admin-home";
import { figure } from "./clinician-home";

const item = (key: AttentionKey, count: ReturnType<typeof figure>): AttentionItem => ({
  key,
  label: (n) => `${n} ${key}`,
  href: `/admin/${key}`,
  count,
});

describe("attentionView", () => {
  it("ranks a serious incident above governance, verification and bookings whatever the counts", () => {
    const view = attentionView([
      item("booking_requests", figure(40, false)),
      item("clinician_verification", figure(9, false)),
      item("ai_governance", figure(3, false)),
      item("serious_incidents", figure(1, false)),
    ]);
    expect(view.kind === "action" && view.top.key).toBe("serious_incidents");
    expect(view.kind === "action" && view.rest.map((r) => r.key)).toEqual(["ai_governance", "clinician_verification", "booking_requests"]);
  });

  it("drops zero items from the list but is clear only when every read succeeded", () => {
    expect(attentionView([item("serious_incidents", figure(0, false)), item("booking_requests", figure(0, false))])).toEqual({ kind: "clear" });
  });

  it("a failed read is never the all-clear (the dangerous case)", () => {
    const view = attentionView([item("serious_incidents", figure(0, true)), item("booking_requests", figure(0, false))]);
    expect(view.kind).toBe("unknown");
    expect(view.kind === "unknown" && view.unknown.map((u) => u.key)).toEqual(["serious_incidents"]);
  });

  it("when something is waiting, a failed read is still listed so the list is not presented as complete", () => {
    const view = attentionView([item("serious_incidents", figure(null, true)), item("booking_requests", figure(2, false))]);
    expect(view.kind).toBe("action");
    expect(view.kind === "action" && view.unknown.map((u) => u.key)).toEqual(["serious_incidents"]);
  });

  it("an empty list (caller can see nothing) is clear, not unknown", () => {
    expect(attentionView([])).toEqual({ kind: "clear" });
  });

  it("uses the item's own wording for the count", () => {
    const view = attentionView([{ ...item("booking_requests", figure(1, false)), label: (n) => `${n} booking request${n === 1 ? "" : "s"}` }]);
    expect(view.kind === "action" && view.top.text).toBe("1 booking request");
  });
});

describe("dependenciesDown", () => {
  it("lists only those down, not unconfigured or not deployed ones", () => {
    expect(
      dependenciesDown({ supabase: { status: "up" }, termii: { status: "unconfigured" }, ml_service: { status: "not_deployed" }, paystack: { status: "down" } }),
    ).toEqual(["paystack"]);
  });
  it("ignores fields that are not dependencies (the report carries a checked_at timestamp)", () => {
    expect(dependenciesDown({ checked_at: "2026-10-30T10:00:00Z", supabase: { status: "down" } })).toEqual(["supabase"]);
  });
  it("is empty when nothing is down", () => {
    expect(dependenciesDown({ supabase: { status: "up" } })).toEqual([]);
  });
});
