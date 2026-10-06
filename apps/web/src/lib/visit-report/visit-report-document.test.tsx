import type { ReactElement, ReactNode } from "react";

// @react-pdf/renderer is ESM only and this CJS jest transform cannot load it,
// so primitives become host tags and the test walks the element tree.
jest.mock("@react-pdf/renderer", () => ({
  Document: "Document",
  Page: "Page",
  Text: "Text",
  View: "View",
  StyleSheet: { create: (styles: unknown) => styles },
}));

import { summariseReadings, type VisitReportReading } from "./summarise";
import { VisitReportDocument } from "./visit-report-document";

function allText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(allText).join(" ");
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (typeof el.type === "function") {
    return allText((el.type as (p: unknown) => ReactNode)(el.props));
  }
  return allText(el.props?.children);
}

const bp: VisitReportReading = {
  vital_type: "blood_pressure",
  taken_at: "2026-10-01T08:00:00Z",
  systolic: 140,
  diastolic: 90,
  pulse_bpm: null,
  glucose_mmol_l: null,
  glucose_context: null,
  weight_kg: null,
  validation_status: "valid",
  source: "wearable",
};

const data = (readings: VisitReportReading[]) => ({
  patientName: "Test Patient",
  generatedAt: "2026-10-06T10:00:00Z",
  summary: summariseReadings(readings, 30),
});

describe("VisitReportDocument", () => {
  it("says so when there is nothing to summarise", () => {
    const text = allText(VisitReportDocument({ data: data([]) }));
    expect(text).toContain("nothing to summarise");
  });

  it("prints BP figures and labels wearable readings as estimates", () => {
    const text = allText(VisitReportDocument({ data: data([bp]) }));
    expect(text).toContain("140/90");
    expect(text).toContain("Wearable estimates");
    expect(text).not.toContain("nothing to summarise");
  });

  it("contains no em dashes and never says doctor", () => {
    const text = allText(VisitReportDocument({ data: data([bp]) }));
    expect(text).not.toContain("—");
    expect(text.toLowerCase()).not.toContain("your doctor");
  });
});
