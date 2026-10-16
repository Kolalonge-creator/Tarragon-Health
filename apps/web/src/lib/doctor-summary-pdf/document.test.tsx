import type { ReactElement, ReactNode } from "react";

// @react-pdf/renderer is ESM only and this CJS jest transform cannot load it, so primitives become host tags and the test walks
// the element tree. The real render is exercised in real-render.test.ts.
jest.mock("@react-pdf/renderer", () => ({
  Document: "Document",
  Page: "Page",
  Text: "Text",
  View: "View",
  Svg: "Svg",
  Line: "Line",
  Circle: "Circle",
  Rect: "Rect",
  Polyline: "Polyline",
  StyleSheet: { create: (s: unknown) => s },
}));
jest.mock("@/lib/pdf/register-fonts", () => ({ registerPdfFonts: () => undefined, PDF_FONT_FAMILY: "Noto Sans" }));

import { DoctorSummaryPdfDocument, SUMMARY_FOOTER } from "./document";
import { sampleData } from "./sample-data";
import { SECTION_KEYS, type SectionKey } from "./model";

function allText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(allText).join("");
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

const render = (sections: SectionKey[]) => DoctorSummaryPdfDocument({ data: sampleData(sections) });

describe("the summary document", () => {
  it("prints every ticked section and the patient-generated footer", () => {
    const text = allText(render([...SECTION_KEYS]));
    for (const heading of ["Allergies", "Ongoing conditions", "Blood pressure readings", "Blood pressure over time", "Current medicines and schedule", "Medicine doses marked taken, by week", "Skipped doses and why", "Symptom journal"]) {
      expect(text).toContain(heading);
    }
    expect(text).toContain("Patient-generated summary, not a clinical document");
    expect(SUMMARY_FOOTER).toMatch(/not a clinical document/);
  });

  it("prints only what was ticked", () => {
    const text = allText(render(["medicines"]));
    expect(text).toContain("Amlodipine");
    expect(text).not.toContain("Blood pressure readings");
    expect(text).not.toContain("Symptom journal");
    expect(text).not.toContain("Skipped doses");
    expect(text).not.toContain("Penicillin");
    expect(count(render(["medicines"]), "Svg")).toBe(0);
  });

  it("draws the chart only when asked, with both lines named in words", () => {
    expect(count(render(["bp"]), "Svg")).toBe(0);
    expect(count(render(["bp_chart"]), "Svg")).toBe(1);
    const text = allText(render(["bp_chart"]));
    expect(count(render(["bp_chart"]), "Polyline")).toBe(2);
    expect(count(render(["bp_chart"]), "Circle")).toBeGreaterThanOrEqual(12);
    expect(count(render(["bp_chart"]), "Rect")).toBeGreaterThanOrEqual(12);
    expect(text).toContain("Home cuff and typed readings only; wearable readings are not drawn");
  });

  it("labels the wearable reading and states it is not in the average", () => {
    const text = allText(render(["bp"]));
    expect(text).toContain("wearable estimate, not in the average");
    expect(text).toMatch(/Average of 12 home cuff and typed readings: 135\/84/);
    expect(text).toMatch(/1 reading from a wearable or another record is listed below but not in the average/);
  });

  it("says where each line came from", () => {
    const text = allText(render(["medicines", "bp"]));
    expect(text).toContain("from a signed prescription");
    expect(text).toContain("added by the patient");
    expect(text).toContain("home cuff, sent by Bluetooth");
    expect(text).toContain("typed in by the patient");
  });

  it("never prints a reproductive entry, a clinician name, a grade or an em dash", () => {
    const text = allText(render([...SECTION_KEYS]));
    expect(text).not.toMatch(/testicular|should never print/i);
    expect(text).not.toMatch(/\bDr\.?\s|reviewed by|checked by Dr|doctor-led/i);
    expect(text).not.toMatch(/\b(high|controlled|uncontrolled|target|abnormal|normal)\b/i);
    expect(text).not.toContain("—");
  });

  it("prints the adherence weeks from the shared formula's numbers and does not invent a percentage for a thin week", () => {
    const text = allText(render(["adherence"]));
    expect(text).toContain("90% (19 of 21 doses)");
    expect(text).toContain("too few doses due to give a percentage");
  });

  it("shows plain empty-state lines rather than blanks", () => {
    const d = sampleData(["bp", "bp_chart", "medicines", "skipped", "symptoms", "allergies_conditions"]);
    d.bp = { lines: [], totalListed: 0, notCounted: 0, excludedFromAverage: 0, average: null, chartReadings: [], truncated: false, capped: false };
    d.chart = null;
    d.medicines = [];
    d.skipped = { lines: [], total: 0 };
    d.symptoms = { lines: [], total: 0, leftOut: 0, capped: false };
    d.allergiesConditions = { allergies: [], conditions: [] };
    const text = allText(DoctorSummaryPdfDocument({ data: d }));
    expect(text).toContain("No readings in this period");
    expect(text).toContain("No home cuff or typed readings in this period to draw");
    expect(text).toContain("No doses were marked skipped in this period");
    expect(text).toContain("No entries in this period");
    expect(text.match(/None recorded/g)?.length).toBe(3);
  });
});
