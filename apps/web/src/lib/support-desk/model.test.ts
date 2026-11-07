import { describe, expect, it } from "@jest/globals";
import { attentionItems, canBulkAssign, describeDue, filterQueue, formatMinutes, sortByUrgency, workloadByOwner, type WorkItem } from "./model";

function item(p: Partial<WorkItem>): WorkItem {
  return {
    source: "support_ticket", item_id: Math.random().toString(36).slice(2), reference: "TK-1", organisation_id: "o", patient_id: "p",
    customer_name: "Ada", is_test: false, category: "technical", priority: "normal", status_group: "new", raw_status: "new",
    subject: "App will not load", assigned_to: null, assigned_to_name: null, received_at: "2026-11-01T08:00:00Z", first_response_at: null,
    resolved_at: null, last_activity_at: null, is_clinical: false, is_escalated: false, open_handoffs: 0, handoff_destinations: [],
    satisfaction: null, channel: "in_app", detail_href: "/x", first_response_due_at: null, resolution_due_at: null, next_due_at: null, clock_from: null, clock_answered_at: null,
    sla_state: "on_track", ...p,
  };
}

describe("filterQueue", () => {
  const me = "me";
  const items = [
    item({ item_id: "a", assigned_to: me }),
    item({ item_id: "b" }),
    item({ item_id: "c", status_group: "resolved", assigned_to: me }),
    item({ item_id: "d", status_group: "awaiting_customer", source: "help_request" }),
    item({ item_id: "e", is_test: true }),
  ];
  it("mine is my open items only", () => expect(filterQueue(items, "mine", me).map((i) => i.item_id)).toEqual(["a"]));
  it("unassigned leaves out resolved and test items", () => expect(filterQueue(items, "unassigned", me).map((i) => i.item_id)).toEqual(["b", "d"]));
  it("a status tab matches the group", () => expect(filterQueue(items, "resolved", me).map((i) => i.item_id)).toEqual(["c"]));
  it("test items show only when asked", () => expect(filterQueue(items, "open", me, { includeTest: true })).toHaveLength(4));
  it("source and search filters narrow", () => {
    expect(filterQueue(items, "open", me, { source: "help_request" }).map((i) => i.item_id)).toEqual(["d"]);
    expect(filterQueue([item({ item_id: "z", reference: "HR-ABC" })], "open", me, { search: "hr-abc" })).toHaveLength(1);
  });
});

describe("sortByUrgency and attention", () => {
  it("puts past-target first, then priority", () => {
    const sorted = sortByUrgency([
      item({ item_id: "low", priority: "low" }),
      item({ item_id: "late", sla_state: "breached" }),
      item({ item_id: "urgent", priority: "urgent" }),
    ]);
    expect(sorted.map((i) => i.item_id)).toEqual(["late", "urgent", "low"]);
  });
  it("lists late and unowned high items, never clinical ones", () => {
    const a = attentionItems([
      item({ item_id: "late", sla_state: "breached" }),
      item({ item_id: "hi", priority: "high" }),
      item({ item_id: "clin", is_clinical: true, sla_state: "breached" }),
      item({ item_id: "fine", assigned_to: "x" }),
    ]);
    expect(a.map((x) => [x.item.item_id, x.reason])).toEqual([["late", "past_target"], ["hi", "unassigned_high"]]);
    expect(a[0]?.next).toBe("Reply to the customer");
  });
});

describe("formatting", () => {
  it("formats minutes", () => {
    expect(formatMinutes(null)).toBe("Not yet");
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(200)).toBe("3 h 20 min");
    expect(formatMinutes(60 * 52)).toBe("2 d 4 h");
  });
  it("describes a due point either side of now", () => {
    const now = new Date("2026-11-07T10:00:00Z");
    expect(describeDue("2026-11-07T12:00:00Z", now)).toBe("due in 2 h");
    expect(describeDue("2026-11-07T09:30:00Z", now)).toBe("30 min late");
    expect(describeDue(null, now)).toBeNull();
  });
});

describe("workload and bulk assignment", () => {
  it("counts open, late and waiting per owner", () => {
    const w = workloadByOwner([
      item({ assigned_to: "x", assigned_to_name: "Bisi", sla_state: "breached" }),
      item({ assigned_to: "x", assigned_to_name: "Bisi", status_group: "awaiting_customer" }),
      item({ assigned_to: "x", status_group: "closed" }),
    ]);
    expect(w).toEqual([{ ownerId: "x", name: "Bisi", open: 2, late: 1, waitingOnCustomer: 1 }]);
  });
  it("never bulk assigns complaints, closed items or doctor-route messages", () => {
    expect(canBulkAssign(item({}))).toBe(true);
    expect(canBulkAssign(item({ source: "complaint" }))).toBe(false);
    expect(canBulkAssign(item({ status_group: "closed" }))).toBe(false);
    expect(canBulkAssign(item({ source: "care_thread", is_clinical: true }))).toBe(false);
  });
});
