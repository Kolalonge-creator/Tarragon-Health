import {
  buildPrecallView,
  describeFollowupError,
  followupLimits,
  formatLagos,
  lagosLocalToIso,
  myFollowupsSchema,
  parseOfferForm,
  precallSchema,
  remainingExtension,
  visibleOfferSlots,
} from "./followups";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

describe("followupLimits", () => {
  it("comes from the versioned configuration (2 to 6 times, a 2 hour lead, routine 10 to 15)", () => {
    expect(followupLimits()).toEqual({ minSlots: 2, maxSlots: 6, leadHours: 2, bulkMax: 50, routineMin: 10, routineMax: 15 });
  });
});

describe("lagosLocalToIso", () => {
  it("reads a typed time as Lagos time (UTC+1)", () => {
    expect(lagosLocalToIso("2026-10-13T09:30")).toBe("2026-10-13T08:30:00.000Z");
  });
  it("rejects text, a missing time and an impossible date", () => {
    expect(lagosLocalToIso("tomorrow")).toBeNull();
    expect(lagosLocalToIso("2026-10-13")).toBeNull();
    expect(lagosLocalToIso("2026-02-31T09:00")).toBeNull();
    expect(lagosLocalToIso("2026-10-13T25:00")).toBeNull();
  });
});

describe("formatLagos", () => {
  it("shows the Lagos clock", () => {
    expect(formatLagos("2026-10-13T08:30:00.000Z")).toBe("Tue 13 Oct, 09:30");
  });
  it("returns an empty string for a bad value", () => {
    expect(formatLagos("not a date")).toBe("");
  });
});

describe("parseOfferForm", () => {
  const base = { patients: [P1], times: ["2026-10-13T09:00", "2026-10-13T09:30", ""], kind: "monthly", minutes: "" };

  it("accepts a valid offer, drops blank boxes and sorts the times", () => {
    const r = parseOfferForm({ ...base, times: ["2026-10-13T09:30", "2026-10-13T09:00", ""] });
    expect(r).toEqual({ ok: true, patients: [P1], starts: ["2026-10-13T08:00:00.000Z", "2026-10-13T08:30:00.000Z"], kind: "monthly", minutes: null });
  });
  it("refuses no Member, and a Member id that is not an id", () => {
    expect(parseOfferForm({ ...base, patients: [] })).toEqual({ ok: false, error: "no_members" });
    expect(parseOfferForm({ ...base, patients: ["nope"] })).toEqual({ ok: false, error: "no_members" });
  });
  it("refuses more Members than the bulk limit", () => {
    const many = Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(parseOfferForm({ ...base, patients: many })).toEqual({ ok: false, error: "too_many_members" });
  });
  it("needs 2 to 6 different times", () => {
    expect(parseOfferForm({ ...base, times: ["2026-10-13T09:00"] })).toEqual({ ok: false, error: "times" });
    expect(parseOfferForm({ ...base, times: ["2026-10-13T09:00", "2026-10-13T09:00"] })).toEqual({ ok: false, error: "times" });
    const seven = Array.from({ length: 7 }, (_, i) => `2026-10-13T0${i + 1}:00`);
    expect(parseOfferForm({ ...base, times: seven })).toEqual({ ok: false, error: "times" });
  });
  it("refuses a time that is not a real date", () => {
    expect(parseOfferForm({ ...base, times: ["2026-10-13T09:00", "soon"] })).toEqual({ ok: false, error: "bad_time" });
  });
  it("lets a routine call be shortened to 10 and refuses anything outside 10 to 15", () => {
    expect(parseOfferForm({ ...base, minutes: "10" })).toMatchObject({ ok: true, minutes: 10 });
    expect(parseOfferForm({ ...base, minutes: "9" })).toEqual({ ok: false, error: "minutes" });
    expect(parseOfferForm({ ...base, minutes: "16" })).toEqual({ ok: false, error: "minutes" });
    expect(parseOfferForm({ ...base, minutes: "12.5" })).toEqual({ ok: false, error: "minutes" });
  });
  it("treats an unknown kind as monthly and keeps the yearly results call", () => {
    expect(parseOfferForm({ ...base, kind: "weird" })).toMatchObject({ ok: true, kind: "monthly" });
    expect(parseOfferForm({ ...base, kind: "yearly_results" })).toMatchObject({ ok: true, kind: "yearly_results" });
  });
  it("de-duplicates Members", () => {
    expect(parseOfferForm({ ...base, patients: [P1, P1, P2] })).toMatchObject({ ok: true, patients: [P1, P2] });
  });
});

describe("describeFollowupError", () => {
  it("shows the database's own plain refusal", () => {
    expect(describeFollowupError({ code: "P0001", message: "there is already an open offer for this person: withdraw it first" }, "x")).toMatch(/already an open offer/);
  });
  it("hides anything else behind the fallback", () => {
    expect(describeFollowupError({ code: "XX000", message: "relation does not exist" }, "fallback")).toBe("fallback");
    expect(describeFollowupError(null, "fallback")).toBe("fallback");
  });
  it("explains a permission refusal", () => {
    expect(describeFollowupError({ code: "42501", message: "denied" }, "x")).toMatch(/do not have access/);
  });
  it("does not pass on a very long message", () => {
    expect(describeFollowupError({ code: "P0001", message: "a".repeat(300) }, "fallback")).toBe("fallback");
  });
});

describe("visibleOfferSlots", () => {
  const offer = {
    offer_id: P1,
    expires_at: "2026-10-13T10:00:00Z",
    call_minutes: 15,
    kind: "monthly" as const,
    longer_requested: false,
    slots: [
      { slot_id: P2, starts_at: "2026-10-13T09:00:00Z", ends_at: "2026-10-13T09:15:00Z" },
      { slot_id: P1, starts_at: "2026-10-13T07:00:00Z", ends_at: "2026-10-13T07:15:00Z" },
    ],
  };
  it("hides a time that has started and sorts the rest", () => {
    const now = new Date("2026-10-13T08:00:00Z");
    expect(visibleOfferSlots(offer, now).map((s) => s.slot_id)).toEqual([P2]);
  });
  it("shows both, soonest first, when both are ahead", () => {
    const now = new Date("2026-10-13T06:00:00Z");
    expect(visibleOfferSlots(offer, now).map((s) => s.slot_id)).toEqual([P1, P2]);
  });
});

describe("myFollowupsSchema", () => {
  it("accepts the shape of a non-Member (nothing at all)", () => {
    expect(myFollowupsSchema.safeParse({ entitlement: null, offers: [] }).success).toBe(true);
  });
  it("accepts a Member with a booked month and no offers", () => {
    const r = myFollowupsSchema.safeParse({
      entitlement: { current: { month_index: 2, state: "booked", period_end: "2026-11-01T00:00:00Z", appointment_id: P1, encounter_id: P2 }, consumed: 1, lapsed: 0, remaining: 10 },
      offers: [],
    });
    expect(r.success).toBe(true);
  });
  it("refuses a shape it does not know rather than guessing", () => {
    expect(myFollowupsSchema.safeParse({ offers: "x" }).success).toBe(false);
  });
});

describe("buildPrecallView", () => {
  const raw = {
    status: "ok",
    encounter: { id: P1, scheduled_at: "2026-10-13T08:00:00Z", planned_minutes: 20, extended_minutes: 5, longer_requested: true },
    since_last_call: "2026-09-13T08:00:00Z",
    summary: {
      patient_first_name: "Ada",
      medications: { active: [{ id: "m1", drug_name: "Amlodipine", dose: "5 mg", frequency: "daily" }], adherence: { percent: 86 } },
      conditions: [{ condition_name: "Hypertension", status: "active" }],
      allergies: [{ allergen: "Penicillin" }],
      pending_proposals: [{ id: "x" }],
    },
    vitals_trend: [{ type: "blood_pressure", readings: 9, first_value: 150, last_value: 138, average: 142.4, average_diastolic: 88.2 }],
    results_since: [{ id: "r1", panel_code: "membership_annual", release_state: "clinician_disclosure_required", received_at: "2026-10-01T08:00:00Z" }],
    medicines_started_since: [{ drug_name: "Metformin", dose: "500 mg", created_at: "2026-09-20T08:00:00Z" }],
    medicine_changes_since: [{ kind: "medication" }, { kind: "target" }],
    open_tasks: [{ type: "amber_bp_review", state: "open", due_at: "2026-10-14T08:00:00Z", priority_class: 2 }],
  };

  it("lays out what a doctor needs before the call", () => {
    const parsed = precallSchema.parse(raw);
    const v = buildPrecallView(parsed);
    expect(v.planned).toBe(20);
    expect(v.extended).toBe(5);
    expect(v.longerRequested).toBe(true);
    expect(v.sinceLabel).toEqual({ kind: "since", when: "Sun 13 Sep, 09:00" });
    expect(v.vitals).toEqual([{ type: "blood pressure", count: 9, first: "150", last: "138", average: "142.4/88.2" }]);
    expect(v.results).toEqual([{ panel: "membership_annual", when: "Thu 1 Oct, 09:00", state: "clinician disclosure required" }]);
    expect(v.medicines.active).toEqual([{ name: "Amlodipine", dose: "5 mg" }]);
    expect(v.medicines.adherencePercent).toBe(86);
    expect(v.medicines.started).toEqual([{ name: "Metformin", dose: "500 mg" }]);
    expect(v.medicines.changes).toBe(2);
    expect(v.tasks).toEqual([{ type: "amber bp review", when: "Wed 14 Oct, 09:00" }]);
    expect(v.conditions).toEqual(["Hypertension"]);
    expect(v.allergies).toEqual(["Penicillin"]);
    expect(v.proposals).toBe(1);
  });

  it("says there was no earlier call and shows empty sections as empty, not as an error", () => {
    const v = buildPrecallView(precallSchema.parse({ status: "partial" }));
    expect(v.sinceLabel).toEqual({ kind: "none" });
    expect(v.vitals).toEqual([]);
    expect(v.results).toEqual([]);
    expect(v.tasks).toEqual([]);
    expect(v.medicines.adherencePercent).toBeNull();
  });

  it("refuses an answer with an unknown status", () => {
    expect(precallSchema.safeParse({ status: "weird" }).success).toBe(false);
  });
});

describe("remainingExtension", () => {
  it("is what is left of the cap and never negative", () => {
    expect(remainingExtension(15, 5)).toBe(10);
    expect(remainingExtension(15, 15)).toBe(0);
    expect(remainingExtension(15, 20)).toBe(0);
  });
});
