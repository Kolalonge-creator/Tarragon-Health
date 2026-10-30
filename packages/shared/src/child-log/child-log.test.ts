import { describe, expect, it, jest } from "@jest/globals";
import {
  createChildSwitcher,
  ageInMonths,
  carriesNutritionReading,
  clampEventTime,
  bandForPoint,
  childEventFromRow,
  childEventsFromRows,
  layoutGrowthChart,
  markerPath,
  mergePending,
  buildChildTimeline,
  buildChildVaccineChecklist,
  checklistCounts,
  childChoices,
  childCrisisLead,
  cleanCaregiverLabel,
  isAsleepNow,
  isSharedKind,
  latestBand,
  mayLog,
  mustRelockOnSwitch,
  pairSleep,
  pickerState,
  reviewedAttribution,
  sortByAttention,
  crisisCallHref,
  withoutCorrected,
  SHARED_TIMELINE_KINDS,
  type ChildEvent,
} from "./index";
import { getProposedConfig } from "../proposed-config";

const ev = (id: string, kind: ChildEvent["kind"], occurredAt: string, extra: Partial<ChildEvent> = {}): ChildEvent => ({
  id, kind, occurredAt, feedType: null, loggedBy: null, correctsId: null, pendingOnPhone: false, ...extra,
});

describe("caregiver label", () => {
  it("is trimmed, collapsed, cleaned of markup and cut to the configured length; empty is null", () => {
    expect(cleanCaregiverLabel("  Aunty   Ngozi ")).toBe("Aunty Ngozi");
    expect(cleanCaregiverLabel("<b>Dad</b>")).toBe("b Dad /b");
    expect(cleanCaregiverLabel("   ")).toBeNull();
    expect(cleanCaregiverLabel(null)).toBeNull();
    const max = getProposedConfig<Record<string, number>>("child_log.settings").value.caregiver_label_max_chars as number;
    expect(cleanCaregiverLabel("x".repeat(max + 20))?.length).toBe(max);
  });
});

describe("append-only events and sleep", () => {
  it("a correcting event hides the row it corrects and nothing else", () => {
    const rows = [ev("a", "nappy_wet", "2026-10-22T08:00:00Z"), ev("b", "nappy_wet", "2026-10-22T08:05:00Z", { correctsId: "a" }), ev("c", "feed", "2026-10-22T09:00:00Z")];
    expect(withoutCorrected(rows).map((r) => r.id)).toEqual(["b", "c"]);
  });

  it("pairs a start with the next stop, leaves an unmatched start open, ignores an orphan stop", () => {
    const spans = pairSleep([
      ev("x", "sleep_stop", "2026-10-22T05:00:00Z"),
      ev("s1", "sleep_start", "2026-10-22T10:00:00Z"),
      ev("e1", "sleep_stop", "2026-10-22T11:30:00Z"),
      ev("s2", "sleep_start", "2026-10-22T13:00:00Z"),
    ]);
    expect(spans).toEqual([
      { startId: "s1", startedAt: "2026-10-22T10:00:00Z", endedAt: "2026-10-22T11:30:00Z", minutes: 90 },
      { startId: "s2", startedAt: "2026-10-22T13:00:00Z", endedAt: null, minutes: null },
    ]);
    expect(isAsleepNow([ev("s2", "sleep_start", "2026-10-22T13:00:00Z"), ev("e1", "sleep_stop", "2026-10-22T11:30:00Z")])).toBe(true);
    expect(isAsleepNow([ev("e1", "sleep_stop", "2026-10-22T14:00:00Z"), ev("s2", "sleep_start", "2026-10-22T13:00:00Z")])).toBe(false);
  });
});

describe("growth bands (words over the database z-scores, shape and word as well as colour)", () => {
  const base = { weightForAgeZ: 0, heightForAgeZ: 0, weightForHeightZ: 0, nutritionClass: "none" as const, implausible: false };
  const rules = getProposedConfig<{ growing_well_max_abs_z: number; keep_an_eye_max_abs_z: number }>("child_log.growth_bands").value;

  it("the worst z decides, at the configured edges", () => {
    expect(bandForPoint(base)).toEqual({ kind: "band", band: "growing_well", crisis: false, recheck: false });
    expect(bandForPoint({ ...base, heightForAgeZ: -rules.growing_well_max_abs_z })).toMatchObject({ band: "growing_well" });
    expect(bandForPoint({ ...base, heightForAgeZ: -(rules.growing_well_max_abs_z + 0.01) })).toMatchObject({ band: "keep_an_eye_on" });
    expect(bandForPoint({ ...base, weightForAgeZ: rules.keep_an_eye_max_abs_z })).toMatchObject({ band: "keep_an_eye_on" });
    expect(bandForPoint({ ...base, weightForAgeZ: rules.keep_an_eye_max_abs_z + 0.01 })).toMatchObject({ band: "talk_to_care_team" });
  });

  it("severe acute nutrition is talk to your care team AND a crisis lead; moderate is talk without the crisis lead", () => {
    expect(bandForPoint({ ...base, nutritionClass: "severe_acute" })).toEqual({ kind: "band", band: "talk_to_care_team", crisis: true, recheck: false });
    expect(bandForPoint({ ...base, nutritionClass: "moderate_acute" })).toEqual({ kind: "band", band: "talk_to_care_team", crisis: false, recheck: false });
    expect(childCrisisLead(bandForPoint({ ...base, nutritionClass: "severe_acute" }))).toBe(true);
    expect(childCrisisLead(bandForPoint(base))).toBe(false);
    expect(childCrisisLead(null)).toBe(false);
  });

  it("a value the database flagged implausible but still routed as severe keeps the crisis lead (MUAC 105 mm, weight-for-height z -5.4)", () => {
    const r = bandForPoint({ ...base, weightForHeightZ: -5.4, nutritionClass: "severe_acute", implausible: true });
    expect(r).toEqual({ kind: "band", band: "talk_to_care_team", crisis: true, recheck: true });
    expect(childCrisisLead(r)).toBe(true);
    // an implausible value that was NOT routed as severe still only asks for a re-check
    expect(bandForPoint({ ...base, nutritionClass: "none", implausible: true })).toEqual({ kind: "check_measurement" });
    expect(childCrisisLead(bandForPoint({ ...base, nutritionClass: "moderate_acute", implausible: true }))).toBe(false);
  });

  it("a MUAC 118 mm row routed moderate that is also flagged implausible keeps talk to your care team, with the re-check note, and no crisis lead", () => {
    const r = bandForPoint({ ...base, weightForHeightZ: -6, nutritionClass: "moderate_acute", implausible: true });
    expect(r).toEqual({ kind: "band", band: "talk_to_care_team", crisis: false, recheck: true });
    expect(childCrisisLead(r)).toBe(false);
  });

  it("an implausible value is never banded; no z-score is never called growing well", () => {
    expect(bandForPoint({ ...base, implausible: true })).toEqual({ kind: "check_measurement" });
    expect(bandForPoint({ ...base, weightForAgeZ: null, heightForAgeZ: null, weightForHeightZ: null })).toEqual({ kind: "no_reference" });
  });

  it("the latest measurement is the one that speaks", () => {
    const r = latestBand([
      { ...base, measuredAt: "2026-01-01T00:00:00Z", heightForAgeZ: -3.5 },
      { ...base, measuredAt: "2026-06-01T00:00:00Z" },
    ]);
    expect(r).toMatchObject({ band: "growing_well" });
    expect(latestBand([])).toBeNull();
  });

  it("sabotage: if the band cut-offs were swapped the edge assertions above would fail (the config is read, not hard-coded)", () => {
    const swapped = { growing_well_max_abs_z: 3, keep_an_eye_max_abs_z: 2 };
    expect(bandForPoint({ ...base, heightForAgeZ: -2.5 }, swapped)).not.toMatchObject({ band: "keep_an_eye_on" });
  });
});

describe("the acute-nutrition class is carried forward (S68d stores a weight-only row as none)", () => {
  const sevRow = { weightForAgeZ: null, heightForAgeZ: null, weightForHeightZ: -3.5, nutritionClass: "severe_acute" as const, implausible: false, measuredAt: "2026-10-01T09:00:00Z", muacMm: 108, bilateralOedema: false };
  const weightOnly = { weightForAgeZ: -1, heightForAgeZ: null, weightForHeightZ: null, nutritionClass: "none" as const, implausible: false, measuredAt: "2026-10-10T09:00:00Z", muacMm: null, bilateralOedema: false };
  it("a weight-only re-weigh after a severe MUAC does NOT clear the crisis lead", () => {
    const r = latestBand([sevRow, weightOnly]);
    expect(childCrisisLead(r)).toBe(true);
  });
  it("a later row WITH a nutrition reading (arm measurement, swelling or weight-for-height) that is non-severe does clear it", () => {
    const wellMuac = { ...weightOnly, measuredAt: "2026-10-15T09:00:00Z", muacMm: 135 };
    expect(childCrisisLead(latestBand([sevRow, weightOnly, wellMuac]))).toBe(false);
    const wellWfh = { ...weightOnly, measuredAt: "2026-10-15T09:00:00Z", weightForHeightZ: -0.5 };
    expect(childCrisisLead(latestBand([sevRow, weightOnly, wellWfh]))).toBe(false);
  });
  it("swelling counts as a nutrition reading, and a first-ever weight-only row has nothing to carry", () => {
    expect(carriesNutritionReading({ ...weightOnly, bilateralOedema: true })).toBe(true);
    expect(carriesNutritionReading(weightOnly)).toBe(false);
    expect(childCrisisLead(latestBand([weightOnly]))).toBe(false);
  });
  it("sabotage: reading only the latest row (the old rule) would clear the lead", () => {
    expect(childCrisisLead(bandForPoint(weightOnly))).toBe(false);
    expect(childCrisisLead(latestBand([sevRow, weightOnly]))).toBe(true);
  });
});

describe("a fast phone clock never loses a tap", () => {
  it("clampEventTime pulls a future time back to now and leaves the past alone", () => {
    const now = Date.parse("2026-10-22T10:00:00Z");
    expect(clampEventTime("2026-10-22T10:30:00Z", now)).toBe("2026-10-22T10:00:00.000Z");
    expect(clampEventTime("2026-10-22T09:00:00Z", now)).toBe("2026-10-22T09:00:00.000Z");
    expect(clampEventTime("garbage", now)).toBe("2026-10-22T10:00:00.000Z");
  });
});

describe("vaccine checklist from the NPHCDA schedule data", () => {
  const catalog = [
    { id: "penta", code: "child_penta", name: "Pentavalent", recommended_age: { age_schedule_weeks: [6, 10, 14], max_age_years: 5 } },
    { id: "hpv", code: "child_hpv_girls", name: "HPV", recommended_age: { age_schedule_weeks: [469], max_age_years: 14, sex: "female" } },
    { id: "adult", code: "tetanus_td_booster", name: "Td", recommended_age: { interval_years: 10 } },
  ];
  const dob = "2026-01-01";

  it("marks done, overdue, due and upcoming from the date of birth, and leaves out what does not apply", () => {
    const list = buildChildVaccineChecklist({
      dateOfBirth: dob, sex: "male", today: "2026-03-30",
      catalog,
      records: [{ vaccination_catalog_id: "penta", dose_number: 1, date_administered: "2026-02-15", verification_status: "pending_verification" }],
    });
    expect(list.map((d) => `${d.code}#${d.doseNumber}:${d.status}`)).toEqual(["child_penta#1:done", "child_penta#2:overdue", "child_penta#3:due"]);
    const first = list[0];
    expect(first?.trust).toBe("waiting");
    expect(first?.doneOn).toBe("2026-02-15");
    expect(checklistCounts(list)).toEqual({ done: 1, due: 1, overdue: 1, upcoming: 0 });
    expect(sortByAttention(list).map((d) => d.status)).toEqual(["overdue", "due", "done"]);
  });

  it("does not offer a dose past its age window, and a rejected record counts for nothing", () => {
    const old = buildChildVaccineChecklist({ dateOfBirth: "2018-01-01", sex: "female", today: "2026-10-22", catalog, records: [] });
    expect(old.find((d) => d.code === "child_penta")).toBeUndefined();
    const rejected = buildChildVaccineChecklist({
      dateOfBirth: dob, sex: "male", today: "2026-02-01", catalog,
      records: [{ vaccination_catalog_id: "penta", dose_number: 1, date_administered: "2026-02-01", verification_status: "rejected" }],
    });
    expect(rejected.find((d) => d.code === "child_penta" && d.doseNumber === 1)?.status).not.toBe("done");
  });

  it("matches strictly by dose number: dose 3 on file does not make dose 2 done", () => {
    const list = buildChildVaccineChecklist({
      dateOfBirth: dob, sex: "male", today: "2026-06-01", catalog,
      records: [
        { vaccination_catalog_id: "penta", dose_number: 1, date_administered: "2026-02-15", verification_status: "self_reported" },
        { vaccination_catalog_id: "penta", dose_number: 3, date_administered: "2026-04-15", verification_status: "self_reported" },
      ],
    });
    expect(list.filter((d) => d.code === "child_penta").map((d) => `${d.doseNumber}:${d.status}`)).toEqual(["1:done", "2:overdue", "3:done"]);
  });

  it("two records on file never complete a series they do not number (no count fallback)", () => {
    const list = buildChildVaccineChecklist({
      dateOfBirth: dob, sex: "male", today: "2026-06-01", catalog,
      records: [
        { vaccination_catalog_id: "penta", dose_number: 7, date_administered: "2026-02-15", verification_status: "self_reported" },
        { vaccination_catalog_id: "penta", dose_number: 8, date_administered: "2026-03-15", verification_status: "self_reported" },
      ],
    });
    expect(list.filter((d) => d.code === "child_penta").map((d) => d.status)).toEqual(["overdue", "overdue", "overdue"]);
  });
});

describe("timeline: one line per event, newest first, nothing sensitive", () => {
  it("merges events, growth and vaccines newest first and applies the limit", () => {
    const items = buildChildTimeline({
      events: [ev("e1", "feed", "2026-10-22T08:00:00Z", { loggedBy: "Mum", feedType: "breast" }), ev("e2", "nappy_wet", "2026-10-22T10:00:00Z", { pendingOnPhone: true })],
      growth: [{ id: "g1", measuredAt: "2026-10-21T09:00:00Z", weightKg: 5.2, heightCm: 58 }],
      vaccines: [{ id: "v1", name: "Pentavalent", doseNumber: 1, dateAdministered: "2026-10-20", verifiedBy: null, verifiedAt: null }],
    });
    expect(items.map((i) => i.id)).toEqual(["e2", "e1", "g1", "v1"]);
    expect(items[0]?.pendingOnPhone).toBe(true);
    expect(buildChildTimeline({ events: [], growth: [], vaccines: [], limit: 0 })).toEqual([]);
  });

  it("the attribution line exists only when both a reviewer and a review time are recorded", () => {
    expect(reviewedAttribution("staff-1", "2026-10-20T10:00:00Z")).toEqual({ reviewedAt: "2026-10-20T10:00:00Z" });
    expect(reviewedAttribution("staff-1", null)).toBeNull();
    expect(reviewedAttribution(null, "2026-10-20T10:00:00Z")).toBeNull();
    const [a, b] = buildChildTimeline({
      events: [], growth: [],
      vaccines: [
        { id: "v1", name: "BCG", doseNumber: 1, dateAdministered: "2026-10-20", verifiedBy: "staff-1", verifiedAt: "2026-10-21T10:00:00Z" },
        { id: "v2", name: "OPV", doseNumber: 1, dateAdministered: "2026-10-19", verifiedBy: null, verifiedAt: "2026-10-21T10:00:00Z" },
      ],
    });
    expect(a?.reviewedAt).toBe("2026-10-21T10:00:00Z");
    expect(b?.reviewedAt).toBeUndefined();
  });

  it("the closed list contains no mother kind, and a foreign kind passed in is dropped", () => {
    for (const k of ["epds", "mood", "loss", "pregnancy_loss", "cycle", "message", "mental_health"]) expect(isSharedKind(k)).toBe(false);
    expect([...SHARED_TIMELINE_KINDS].sort()).toEqual(["feed", "growth", "nappy_dirty", "nappy_wet", "sleep_start", "sleep_stop", "vaccine"]);
    const sneaky = { ...ev("z", "feed", "2026-10-22T12:00:00Z"), kind: "epds" } as unknown as ChildEvent;
    expect(buildChildTimeline({ events: [sneaky], growth: [], vaccines: [] })).toEqual([]);
  });
});

describe("whose baby: only under 18", () => {
  const dep = (profileId: string, dateOfBirth: string | null, permissionLevel: "view" | "manage" = "manage") => ({ profileId, fullName: "Kid", permissionLevel, isDependentAccount: true, dependentKind: "minor_child", dateOfBirth });
  it("an adult dependent is never offered, so no log button can be reached for them", () => {
    const c = childChoices([dep("teen", "2008-10-23"), dep("adult", "2008-10-22"), dep("older", "1990-01-01")], "2026-10-22");
    expect(c.map((x) => x.profileId)).toEqual(["teen"]);
  });
  it("the day before the 18th birthday is still a child, the birthday is not", () => {
    expect(childChoices([dep("a", "2008-10-23")], "2026-10-22")).toHaveLength(1);
    expect(childChoices([dep("a", "2008-10-22")], "2026-10-22")).toHaveLength(0);
  });
  it("no date of birth: offered, but look-only (nothing is logged against an age we cannot check)", () => {
    const c = childChoices([dep("n", null)], "2026-10-22");
    expect(c).toHaveLength(1);
    expect(mayLog(c[0]!)).toBe(false);
  });
});

describe("whose baby", () => {
  const supported = [
    { profileId: "c1", fullName: "Ada Obi Okoro", permissionLevel: "manage" as const, isDependentAccount: true, dependentKind: "minor_child", dateOfBirth: "2026-01-15" },
    { profileId: "c2", fullName: "Tobi Okoro", permissionLevel: "view" as const, isDependentAccount: true, dependentKind: "minor_child", dateOfBirth: "2024-05-01" },
    { profileId: "a1", fullName: "Grandma", permissionLevel: "manage" as const, isDependentAccount: true, dependentKind: "elder_proxy", dateOfBirth: "1950-01-01" },
    { profileId: "p1", fullName: "Not dependent", permissionLevel: "manage" as const, isDependentAccount: false, dependentKind: null, dateOfBirth: null },
  ];
  it("offers minor children only, first names only, and keeps a view grant as view", () => {
    const c = childChoices(supported, "2026-10-22");
    expect(c.map((x) => [x.profileId, x.firstName, x.access])).toEqual([["c1", "Ada", "manage"], ["c2", "Tobi", "view"]]);
    expect(mayLog(c[0]!)).toBe(true);
    expect(mayLog(c[1]!)).toBe(false);
  });
  it("asks when there is more than one child and no valid remembered choice; never trusts an unknown id", () => {
    const c = childChoices(supported);
    expect(pickerState([], null).kind).toBe("none");
    expect(pickerState(c.slice(0, 1), null).kind).toBe("chosen");
    expect(pickerState(c, null).kind).toBe("ask");
    expect(pickerState(c, "ghost").kind).toBe("ask");
    expect(pickerState(c, "c2")).toMatchObject({ kind: "chosen", child: { profileId: "c2" } });
  });
  it("switching child locks the private section again", () => {
    expect(mustRelockOnSwitch("c1", "c2")).toBe(true);
    expect(mustRelockOnSwitch("c1", "c1")).toBe(false);
    expect(mustRelockOnSwitch(null, "c1")).toBe(false);
  });
});

describe("tap to call", () => {
  it("builds a tel link only from a plausible number", () => {
    expect(crisisCallHref("112")).toBe("tel:112");
    expect(crisisCallHref("+2348012345678")).toBe("tel:+2348012345678");
    expect(crisisCallHref("112;rm")).toBeNull();
    expect(crisisCallHref("")).toBeNull();
  });
});

describe("rows and chart layout", () => {
  it("accepts a well-formed row, rejects anything else, and carries the client id", () => {
    const ok = childEventFromRow({ id: "a", kind: "feed", occurred_at: "2026-10-22T08:00:00Z", feed_type: "bottle", logged_by_label: "Dad", corrects_id: null, client_id: "c1" });
    expect(ok).toMatchObject({ id: "a", kind: "feed", feedType: "bottle", loggedBy: "Dad", clientId: "c1", pendingOnPhone: false });
    expect(childEventFromRow({ id: "a", kind: "epds", occurred_at: "x" })).toBeNull();
    expect(childEventFromRow(null)).toBeNull();
    expect(childEventsFromRows("nope")).toEqual([]);
  });

  it("a pending tap disappears once the server has the same client id", () => {
    const server = childEventsFromRows([{ id: "s1", kind: "nappy_wet", occurred_at: "2026-10-22T08:00:00Z", client_id: "c1" }]);
    const base = server[0]!;
    const pending = [
      { ...base, id: "c1", pendingOnPhone: true, clientId: "c1" },
      { ...base, id: "c2", pendingOnPhone: true, clientId: "c2" },
    ];
    expect(mergePending(server, pending).map((e) => e.id)).toEqual(["s1", "c2"]);
  });

  it("lays out one marker per point with a shape that matches the band, a square when unread", () => {
    const layout = layoutGrowthChart(
      [
        { id: "a", ageMonths: 1, value: 4.2, band: "growing_well" },
        { id: "b", ageMonths: 3, value: 5.0, band: "keep_an_eye_on" },
        { id: "c", ageMonths: 6, value: 6.1, band: "talk_to_care_team" },
        { id: "d", ageMonths: 9, value: 7.0, band: null },
      ],
      { width: 300, height: 200 },
    );
    expect(layout.markers.map((m) => m.shape)).toEqual(["circle", "diamond", "triangle", "square"]);
    expect(layout.markers.every((m) => m.x >= 0 && m.x <= 300 && m.y >= 0 && m.y <= 200)).toBe(true);
    expect(layout.markers[0]!.x).toBeLessThan(layout.markers[3]!.x);
    expect(layout.markers[0]!.y).toBeGreaterThan(layout.markers[3]!.y);
    expect(layout.polyline.split(" ")).toHaveLength(4);
    expect(markerPath("triangle", 10, 10, 5)).toMatch(/^M /);
    expect(layoutGrowthChart([], { width: 300, height: 200 }).markers).toEqual([]);
    expect(ageInMonths("2026-01-01", "2026-04-02T10:00:00Z")).toBeCloseTo(3.1, 0);
  });
});

describe("the real switch-child flow relocks the private section", () => {
  it("leaving a child relocks at once, and choosing the other child does not need a second relock", () => {
    const relock = jest.fn();
    const sw = createChildSwitcher(relock);
    sw.show("c1");
    expect(relock).not.toHaveBeenCalled();
    sw.leave(); // "Switch child" pressed: the screen clears its choice here
    expect(relock).toHaveBeenCalledTimes(1);
    sw.show("c2");
    expect(relock).toHaveBeenCalledTimes(1);
  });
  it("leaving and choosing the SAME child still relocks (a handed-over phone)", () => {
    const relock = jest.fn();
    const sw = createChildSwitcher(relock);
    sw.show("c1");
    sw.leave();
    sw.show("c1");
    expect(relock).toHaveBeenCalledTimes(1);
  });
  it("a direct change of child with no leave (a link or the back button) relocks", () => {
    const relock = jest.fn();
    const sw = createChildSwitcher(relock);
    sw.show("c1");
    sw.show("c2");
    expect(relock).toHaveBeenCalledTimes(1);
    sw.show("c2");
    expect(relock).toHaveBeenCalledTimes(1);
  });
  it("nothing is relocked before any child was shown", () => {
    const relock = jest.fn();
    const sw = createChildSwitcher(relock);
    sw.leave();
    sw.show("c1");
    expect(relock).not.toHaveBeenCalled();
  });
  it("sabotage: the old comparison (previous id read after the screen cleared it) never relocks", () => {
    const clearedFirst: string | null = null;
    expect(mustRelockOnSwitch(clearedFirst, "c2")).toBe(false);
  });
});
