import { describe, expect, it } from "@jest/globals";
import {
  birthPlanToForm,
  buildBirthPlanFields,
  birthPlanFlags,
  contractionCard,
  contractionTimings,
  koboToNairaText,
  nairaTextToKobo,
  phoneToE164,
  scheduleEntries,
  weekCardState,
  type PregnancyContentRow,
} from "./index";

const row = (over: Partial<PregnancyContentRow>): PregnancyContentRow => ({
  kind: "week", week: 30, title: "t", body_text: "b", review_state: "cmo_reviewed", version: 1, ...over,
});

describe("plan-note money (never a balance)", () => {
  it("turns whole naira into integer kobo", () => {
    expect(nairaTextToKobo("50,000")).toEqual({ ok: true, kobo: 5_000_000 });
    expect(nairaTextToKobo(" ₦2500 ")).toEqual({ ok: true, kobo: 250_000 });
    expect(nairaTextToKobo("")).toEqual({ ok: true, kobo: null });
  });
  it("refuses decimals, words and absurd amounts", () => {
    for (const bad of ["10.5", "ten", "-5", "99999999999999"]) expect(nairaTextToKobo(bad)).toEqual({ ok: false });
  });
  it("round-trips for the form", () => {
    expect(koboToNairaText(5_000_000)).toBe("50000");
    expect(koboToNairaText(null)).toBe("");
  });
});

describe("phone numbers are E.164", () => {
  it("accepts +234 numbers and tidies spaces", () => {
    expect(phoneToE164("+234 803 123 4567")).toEqual({ ok: true, phone: "+2348031234567" });
    expect(phoneToE164("")).toEqual({ ok: true, phone: null });
  });
  it("refuses a local number and letters", () => {
    expect(phoneToE164("08031234567")).toEqual({ ok: false });
    expect(phoneToE164("+23480ABC")).toEqual({ ok: false });
  });
});

describe("week card shows only reviewed content", () => {
  it("is coming-soon with no rows, and never shows a draft", () => {
    expect(weekCardState(30, [])).toEqual({ kind: "coming_soon", week: 30 });
    expect(weekCardState(30, [row({ review_state: "draft_pending_cmo", body_text: "invented" })])).toEqual({ kind: "coming_soon", week: 30 });
  });
  it("shows the latest reviewed version for exactly that week", () => {
    const rows = [row({ version: 1, title: "old" }), row({ version: 2, title: "new" }), row({ week: 31, title: "other" })];
    expect(weekCardState(30, rows)).toEqual({ kind: "content", week: 30, title: "new", body: "b" });
  });
  it("asks for dating when the week is unknown", () => {
    expect(weekCardState(null, [row({})])).toEqual({ kind: "unknown_week" });
  });
});

describe("antenatal schedule view", () => {
  it("orders by visit number, marks a booked visit, and invents no lateness", () => {
    const entries = scheduleEntries([
      { id: "b", visit_number: 2, target_week: 20, gestational_week_at_visit: null, status: "scheduled", appointment_id: "appt-1" },
      { id: "a", visit_number: 1, target_week: 12, gestational_week_at_visit: null, status: "completed" },
      { id: "c", visit_number: 3, target_week: 26, gestational_week_at_visit: null, status: "scheduled" },
    ]);
    expect(entries.map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(entries.map((e) => e.booked)).toEqual([false, true, false]);
    expect(entries.every((e) => !("overdue" in e))).toBe(true);
    expect(entries[1]!.status).toBe("scheduled");
  });
});

describe("birth plan form to row", () => {
  const form = { place: " Clinic ", transport: "", money: "20,000", donorName: "", donorPhone: "", escortName: "Ada", escortPhone: "+2348031234567", longJourney: true, previousFastLabour: false, previousBirths: "2" };
  it("builds a row with kobo and E.164 and blanks as null", () => {
    const r = buildBirthPlanFields(form);
    expect(r).toEqual({ ok: true, plan: expect.objectContaining({ place_of_birth: "Clinic", transport_plan: null, money_plan_kobo: 2_000_000, escort_phone: "+2348031234567", long_journey: true, previous_births: 2 }) });
  });
  it("reports every bad field at once and builds nothing", () => {
    expect(buildBirthPlanFields({ ...form, money: "x", donorPhone: "0803" })).toEqual({ ok: false, errors: { money: true, donorPhone: true, escortPhone: false } });
  });
  it("clamps the number of births and round-trips through the form", () => {
    const r = buildBirthPlanFields({ ...form, previousBirths: "99" });
    expect(r.ok && r.plan.previous_births).toBe(20);
    if (r.ok) expect(birthPlanToForm(r.plan).money).toBe("20000");
  });
  it("keeps an existing money note instead of writing null over it", () => {
    const r = buildBirthPlanFields(form, { money_plan_note: "from the clinic" });
    expect(r.ok && r.plan.money_plan_note).toBe("from the clinic");
  });
  it("has no balance or wallet column", () => {
    const r = buildBirthPlanFields(form);
    expect(r.ok && Object.keys(r.plan).some((k) => /balance|wallet|topup/i.test(k))).toBe(false);
  });
});

describe("contraction helpers", () => {
  it("reads the birth plan for the earlier pattern, and null with no plan", () => {
    expect(birthPlanFlags(null)).toBeNull();
    expect(birthPlanFlags({ long_journey: true, previous_fast_labour: false, previous_births: 0 })).toEqual({ longJourney: true, previousFastLabour: false, previousBirths: 0 });
  });
  it("stores timings relative to the first start", () => {
    expect(contractionTimings([{ startMs: 5_000, endMs: 65_000 }, { startMs: 305_000, endMs: null }], 5_000, 365_000)).toEqual([
      { s: 0, d: 60 },
      { s: 300, d: 60 },
    ]);
  });
  it("only ever offers go-now cards, never a wait card", () => {
    expect(contractionCard({ state: "keep_timing", reason: null })).toBe("none");
    expect(contractionCard({ state: "go_now", reason: "pattern" })).toBe("go_now_pattern");
    expect(contractionCard({ state: "go_now", reason: "instant_sign" })).toBe("go_now_sign");
  });
});
