import {
  applyFilters,
  applySavedView,
  attentionReason,
  computeKpis,
  contactIsStale,
  countByCategory,
  isDueToday,
  isOverdue,
  needsAttention,
  paginate,
  sortItems,
  workItemHref,
  workItemSchema,
  canTakeOver,
  offerTakeOver,
  type WorkItem,
} from "./work-items";

const ME = "11111111-1111-4111-8111-111111111111";
const DOC = "22222222-2222-4222-8222-222222222222";
// The platform's real organisation id is not an RFC 4122 UUID (version nibble 0). A strict .uuid() check rejected every row and
// the whole board showed "could not be loaded"; this id keeps that from coming back.
const ORG = "00000000-0000-0000-0000-000000000001";
// 10:00 in Lagos (UTC+1) on 7 Nov 2026
const NOW = new Date("2026-11-07T09:00:00Z");

let n = 0;
function item(over: Partial<WorkItem> = {}): WorkItem {
  n += 1;
  return {
    source: "outreach",
    item_id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    organisation_id: ORG,
    patient_id: `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`,
    patient_name: `Patient ${n}`,
    patient_number: `TH-${n}`,
    category: "outreach",
    kind: "stale_monitoring",
    priority: 2,
    due_at: null,
    status: "open",
    raw_status: "open",
    assigned_to: ME,
    assigned_name: "Me",
    assigned_is_coordinator: true,
    auto_assigned: true,
    created_at: "2026-11-07T08:00:00Z",
    last_activity_at: "2026-11-07T08:00:00Z",
    ...over,
  };
}

describe("work item schema", () => {
  it("accepts a row shaped like the view and rejects an unknown status", () => {
    expect(workItemSchema.safeParse(item()).success).toBe(true);
    expect(workItemSchema.safeParse({ ...item(), status: "closed" }).success).toBe(false);
  });
});

describe("due dates in Lagos time", () => {
  it("overdue means past now; due today means later today in Lagos", () => {
    expect(isOverdue(item({ due_at: "2026-11-07T08:59:00Z" }), NOW)).toBe(true);
    expect(isOverdue(item({ due_at: null }), NOW)).toBe(false);
    expect(isDueToday(item({ due_at: "2026-11-07T22:30:00Z" }), NOW)).toBe(true); // 23:30 Lagos, still today
    expect(isDueToday(item({ due_at: "2026-11-07T23:30:00Z" }), NOW)).toBe(false); // 00:30 Lagos, tomorrow
    expect(isDueToday(item({ due_at: "2026-11-07T08:00:00Z" }), NOW)).toBe(false); // overdue is not "due today"
  });
});

describe("saved views", () => {
  const rows = [
    item({ assigned_to: ME }),
    item({ assigned_to: DOC, assigned_is_coordinator: false }),
    item({ assigned_to: null }),
    item({ status: "awaiting_patient" }),
    item({ status: "awaiting_clinician" }),
    item({ due_at: "2026-11-06T09:00:00Z" }),
  ];
  it("mine, unassigned, awaiting, overdue and all each pick the right rows", () => {
    expect(applySavedView(rows, "mine", ME, NOW)).toHaveLength(4);
    expect(applySavedView(rows, "unassigned", ME, NOW)).toHaveLength(1);
    expect(applySavedView(rows, "awaiting_patient", ME, NOW)).toHaveLength(1);
    expect(applySavedView(rows, "awaiting_other", ME, NOW)).toHaveLength(1);
    expect(applySavedView(rows, "overdue", ME, NOW)).toHaveLength(1);
    expect(applySavedView(rows, "all", ME, NOW)).toHaveLength(rows.length);
  });
});

describe("filters and sort", () => {
  it("searches name, number and owner; filters category and status", () => {
    const rows = [item({ patient_name: "Ngozi Okafor" }), item({ category: "support", source: "support" }), item({ assigned_name: "Dr Bello" })];
    expect(applyFilters(rows, { search: "ngozi", category: "all", status: "all" })).toHaveLength(1);
    expect(applyFilters(rows, { search: "bello", category: "all", status: "all" })).toHaveLength(1);
    expect(applyFilters(rows, { search: "", category: "support", status: "all" })).toHaveLength(1);
    expect(applyFilters(rows, { search: "", category: "all", status: "in_progress" })).toHaveLength(0);
  });

  it("puts overdue first, then act-first, then soonest due", () => {
    const a = item({ priority: 3 });
    const b = item({ priority: 1 });
    const c = item({ priority: 3, due_at: "2026-11-06T00:00:00Z" });
    const d = item({ priority: 2, due_at: "2026-11-08T00:00:00Z" });
    expect(sortItems([a, b, c, d], "priority", NOW).map((x) => x.item_id)).toEqual([c, b, d, a].map((x) => x.item_id));
  });
});

describe("needs attention", () => {
  it("names the fact that put an item there and never invents urgency", () => {
    expect(attentionReason(item({ due_at: "2026-11-06T00:00:00Z" }), NOW)).toBe("overdue");
    expect(attentionReason(item({ priority: 1 }), NOW)).toBe("act_first");
    expect(attentionReason(item({ created_at: "2026-11-03T00:00:00Z" }), NOW)).toBe("waiting");
    expect(attentionReason(item({ created_at: "2026-11-06T00:00:00Z" }), NOW)).toBeNull();
  });

  it("covers only my items and unassigned ones, not another person's", () => {
    const rows = [item({ priority: 1 }), item({ priority: 1, assigned_to: null }), item({ priority: 1, assigned_to: DOC })];
    expect(needsAttention(rows, ME, NOW)).toHaveLength(2);
  });
});

describe("KPIs", () => {
  it("counts mine, team-wide support, follow-ups, unassigned and doctor-held work", () => {
    const rows = [
      item({ due_at: "2026-11-06T00:00:00Z" }),
      item({ due_at: "2026-11-07T20:00:00Z" }),
      item({ status: "awaiting_patient" }),
      item({ source: "support", category: "support", assigned_to: null }),
      item({ category: "follow_up", assigned_to: DOC, assigned_is_coordinator: false }),
    ];
    expect(computeKpis(rows, ME, NOW)).toEqual({
      myOpen: 3,
      dueToday: 1,
      overdue: 1,
      awaitingPatient: 1,
      openSupport: 1,
      resultFollowUps: 1,
      unassigned: 1,
      heldByDoctors: 1,
    });
  });

  it("lists every category, zero included, in a fixed order", () => {
    expect(countByCategory([item()]).map((c) => c.category)).toEqual(["outreach", "follow_up", "support", "programme", "queue"]);
    expect(countByCategory([]).every((c) => c.count === 0)).toBe(true);
  });
});

describe("links and take-over", () => {
  it("routes each source to the page where the work is done", () => {
    expect(workItemHref(item({ category: "follow_up" }))).toBe("/dashboard/care-coordinator/follow-ups");
    expect(workItemHref(item({ source: "support", category: "support" }))).toBe("/dashboard/care-coordinator/support-requests");
    const q = item({ source: "queue", category: "queue" });
    expect(workItemHref(q)).toBe(`/clinician/tasks/${q.item_id}`);
  });

  it("never offers to take a queue task by hand (it has its own claim rules)", () => {
    expect(canTakeOver({ source: "queue" })).toBe(false);
    expect(canTakeOver({ source: "programme" })).toBe(true);
  });

  it("offers 'Take it' only on work nobody has started, never on another person's hand claim", () => {
    expect(offerTakeOver(item({ assigned_to: null, auto_assigned: false }), ME)).toBe(true);
    expect(offerTakeOver(item({ assigned_to: DOC, auto_assigned: true }), ME)).toBe(true);
    expect(offerTakeOver(item({ assigned_to: DOC, auto_assigned: false }), ME)).toBe(false);
    expect(offerTakeOver(item({ assigned_to: ME }), ME)).toBe(false);
    expect(offerTakeOver(item({ source: "queue", category: "queue", assigned_to: null }), ME)).toBe(false);
  });
});

describe("paginate and contact staleness", () => {
  it("clamps the page and counts pages", () => {
    const r = paginate(Array.from({ length: 51 }, (_, i) => i), 9, 25);
    expect(r).toEqual({ rows: [50], page: 3, pages: 3 });
  });

  it("calls no contact, or none in 30 days, stale", () => {
    expect(contactIsStale({ last_contact_at: null }, NOW)).toBe(true);
    expect(contactIsStale({ last_contact_at: "2026-10-01T00:00:00Z" }, NOW)).toBe(true);
    expect(contactIsStale({ last_contact_at: "2026-11-01T00:00:00Z" }, NOW)).toBe(false);
  });
});
