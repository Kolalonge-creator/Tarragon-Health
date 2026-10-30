import type { ReactElement, ReactNode } from "react";

// @react-pdf/renderer is ESM only and this CJS jest transform cannot load it, so primitives become host tags and the test walks the element tree.
jest.mock("@react-pdf/renderer", () => ({
  Document: "Document",
  Page: "Page",
  Text: "Text",
  View: "View",
  Svg: "Svg",
  Path: "Path",
  Polyline: "Polyline",
  StyleSheet: { create: (s: unknown) => s },
}));

import { ChildRecordDocument } from "./child-record-document";
import { buildChildRecord, type GrowthSourceRow } from "./build-child-record";

function allText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(allText).join(" ");
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (typeof el.type === "function") return allText((el.type as (p: unknown) => ReactNode)(el.props));
  return allText(el.props?.children);
}
function count(node: ReactNode, tag: string): number {
  if (node == null || typeof node !== "object") return 0;
  if (Array.isArray(node)) return node.reduce((n: number, c) => n + count(c, tag), 0);
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (typeof el.type === "function") return count((el.type as (p: unknown) => ReactNode)(el.props), tag);
  return (el.type === tag ? 1 : 0) + count(el.props?.children, tag);
}

const growth: GrowthSourceRow[] = [
  { id: "g1", measured_at: "2026-02-01T09:00:00Z", weight_kg: 4.2, height_cm: 55, weight_for_age_z: 0.1, height_for_age_z: 0.2, weight_for_height_z: 0, nutrition_class: "none", plausibility_flags: [] },
  { id: "g2", measured_at: "2026-04-01T09:00:00Z", weight_kg: 5.5, height_cm: 60, weight_for_age_z: -2.4, height_for_age_z: -1, weight_for_height_z: -1, nutrition_class: "none", plausibility_flags: [] },
];
const catalog = [{ id: "penta", code: "child_penta", name: "Pentavalent", recommended_age: { age_schedule_weeks: [6, 10, 14], max_age_years: 5 } }];
const input = {
  name: "Ada", dateOfBirth: "2026-01-01", sex: "female" as const, today: "2026-03-30", generatedAt: "2026-03-30T10:00:00Z",
  growth, catalog, records: [{ vaccination_catalog_id: "penta", dose_number: 1, date_administered: "2026-02-15", verification_status: "verified" }],
};

describe("buildChildRecord", () => {
  it("uses the database z-scores for the band word and the schedule data for the vaccine rows", () => {
    const data = buildChildRecord(input);
    expect(data.latestBand).toBe("keep_an_eye_on");
    expect(data.weightPoints.map((p) => p.value)).toEqual([4.2, 5.5]);
    expect(data.doses.map((d) => `${d.doseNumber}:${d.status}`)).toEqual(["1:done", "2:overdue", "3:due"]);
  });
  it("has no vaccine rows without a date of birth, and no band when nothing could be read", () => {
    const data = buildChildRecord({ ...input, dateOfBirth: null, growth: [] });
    expect(data.doses).toEqual([]);
    expect(data.latestBand).toBeNull();
  });
});

describe("a severe result leads the record, even when the value was flagged implausible (S68d keeps and routes it)", () => {
  const severe: GrowthSourceRow = { id: "g9", measured_at: "2026-04-01T09:00:00Z", weight_kg: 4, height_cm: 60, weight_for_age_z: null, height_for_age_z: null, weight_for_height_z: -5.4, nutrition_class: "severe_acute", plausibility_flags: ["wfh_implausible"] };
  it("sets the crisis flag and prints go to the nearest clinic now", () => {
    const data = buildChildRecord({ ...input, growth: [severe] });
    expect(data.crisis).toBe(true);
    expect(data.latestBand).toBe("talk_to_care_team");
    expect(allText(ChildRecordDocument({ data }))).toMatch(/nearest clinic now/);
  });
  it("a weight-only re-weigh after the severe row does not clear the lead on the page (the class is carried forward)", () => {
    const reweigh: GrowthSourceRow = { id: "g10", measured_at: "2026-04-10T09:00:00Z", weight_kg: 4.5, height_cm: null, weight_for_age_z: -1, height_for_age_z: null, weight_for_height_z: null, nutrition_class: "none", plausibility_flags: [], muac_mm: null, bilateral_oedema: false };
    const data = buildChildRecord({ ...input, growth: [{ ...severe, muac_mm: 105, bilateral_oedema: false }, reweigh] });
    expect(data.crisis).toBe(true);
  });
  it("a MUAC 118 mm moderate row flagged implausible keeps talk to your care team on the page", () => {
    const moderate: GrowthSourceRow = { ...severe, nutrition_class: "moderate_acute", muac_mm: 118 };
    expect(buildChildRecord({ ...input, growth: [moderate] }).latestBand).toBe("talk_to_care_team");
  });
  it("no lead when nothing severe", () => {
    expect(buildChildRecord(input).crisis).toBe(false);
    expect(allText(ChildRecordDocument({ data: buildChildRecord(input) }))).not.toMatch(/nearest clinic now/);
  });
});

describe("ChildRecordDocument", () => {
  const doc = ChildRecordDocument({ data: buildChildRecord(input) });
  it("is exactly one page, with the growth chart and the vaccine record", () => {
    expect(count(doc, "Page")).toBe(1);
    expect(count(doc, "Svg")).toBe(2);
    expect(count(doc, "Path")).toBe(4);
    const text = allText(doc);
    expect(text).toMatch(/Growth and vaccine record/);
    expect(text).toMatch(/Keep an eye on/);
    expect(text).toMatch(/Pentavalent/);
    expect(text).toMatch(/Checked by your care team/);
    expect(text).toMatch(/not a diagnosis/i);
  });
  it("uses kg and cm, no em dash, and never says 'your doctor'", () => {
    const text = allText(doc);
    expect(text).toMatch(/Weight \(kg\)/);
    expect(text).toMatch(/Height \(cm\)/);
    expect(text).not.toMatch(/—|your doctor|\blb\b/i);
  });
  it("says so when nothing has been recorded, rather than printing blank charts", () => {
    const empty = ChildRecordDocument({ data: buildChildRecord({ ...input, growth: [], records: [], dateOfBirth: null }) });
    expect(count(empty, "Svg")).toBe(0);
    expect(allText(empty)).toMatch(/No measurements recorded/);
    expect(allText(empty)).toMatch(/No vaccines on the schedule/);
  });
  it("the vaccine name column is cut with the maxLines STYLE key, not a prop", () => {
    const rowsWithName = (JSON.stringify(doc, (_k, v) => (typeof v === "function" ? undefined : v)) ?? "");
    expect(rowsWithName).toContain('"maxLines":1');
    expect(rowsWithName).not.toContain('"maxLines":1,"children"');
  });
});
