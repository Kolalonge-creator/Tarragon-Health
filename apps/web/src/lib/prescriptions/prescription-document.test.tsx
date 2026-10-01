import type { ReactElement } from "react";

// @react-pdf/renderer ships ESM only, which this CJS ts-jest transform cannot load, so the primitives become
// plain host tags and the test walks the element tree (same approach as lib/invoices/invoice-document.test.tsx).
jest.mock("@react-pdf/renderer", () => ({
  Document: "Document",
  Page: "Page",
  Text: "Text",
  View: "View",
  Image: "Image",
  StyleSheet: { create: (styles: unknown) => styles },
}));
jest.mock("@/lib/pdf/register-fonts", () => ({
  registerPdfFonts: () => undefined,
  PDF_FONT_FAMILY: "Helvetica",
}));

import { NOT_CONTROLLED_STATEMENT, PrescriptionPdf, REPEAT_STATEMENT, VERIFY_STATEMENT } from "./prescription-document";
import type { PrescriptionPdfData } from "./prescription-pdf-data";

/** Expands function components and gathers every string, so what a pharmacist would read is what is asserted. */
function collectText(node: unknown, out: string[] = []): string[] {
  if (node == null || node === false) return out;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((child) => collectText(child, out));
    return out;
  }
  const element = node as ReactElement<{ children?: unknown }>;
  if (typeof element.type === "function") {
    return collectText((element.type as (props: unknown) => unknown)(element.props), out);
  }
  return collectText(element.props?.children, out);
}

function countPages(node: unknown): number {
  if (node == null || typeof node !== "object") return 0;
  if (Array.isArray(node)) return node.reduce((sum: number, child) => sum + countPages(child), 0);
  const element = node as ReactElement<{ children?: unknown }>;
  if (typeof element.type === "function") return countPages((element.type as (props: unknown) => unknown)(element.props));
  return (element.type === "Page" ? 1 : 0) + countPages(element.props?.children);
}

const rx = (n: number, overrides: Partial<PrescriptionPdfData> = {}): PrescriptionPdfData => ({
  medicationId: `00000000-0000-4000-8000-00000000000${n}`,
  patientName: "First Patient",
  patientNumber: "TH-002610",
  dateOfBirth: "1985-03-04",
  drugName: n === 1 ? "Amlodipine" : "Metformin",
  dose: n === 1 ? "5 mg" : "500 mg",
  frequency: "Once daily",
  route: "Oral",
  quantity: "30 tablets",
  durationDays: 30,
  repeatsAllowed: 2,
  indication: "Hypertension",
  instructions: "Take in the morning",
  rxNumber: `TRG-RX-2026-00036${n}`,
  verificationCode: `A1B2C${n}`,
  publicToken: "d".repeat(64),
  version: 1,
  amendmentReason: null,
  signedAt: "2026-10-01T09:00:00Z",
  validUntil: "2027-04-01T00:00:00Z",
  prescriberName: "Ada Longe",
  prescriberCredential: "MDCN 123456",
  ...overrides,
});

describe("PrescriptionPdf", () => {
  it("prints everything a pharmacist needs, including the Rx number and verification code in clear text", () => {
    const text = collectText(PrescriptionPdf({ prescriptions: [rx(1)] })).join(" ").replace(/\s+/g, " ");
    for (const expected of [
      "Amlodipine",
      "5 mg",
      "Once daily",
      "30 tablets",
      "30 days",
      "TRG-RX-2026-000361",
      "A1B2C1",
      "Dr. Ada Longe",
      "MDCN 123456",
      "TH-002610",
      "First Patient",
      "Hypertension",
    ]) {
      expect(text).toContain(expected);
    }
  });

  it("says the prescription is not for a controlled medicine, and never claims single use", () => {
    const text = collectText(PrescriptionPdf({ prescriptions: [rx(1)] })).join("\n");
    expect(text).toContain(NOT_CONTROLLED_STATEMENT);
    expect(text).toContain(REPEAT_STATEMENT);
    expect(text).not.toMatch(/single[- ]use|one[- ]time use/i);
  });

  it("has no patient address or phone field (founder decision D4: name, patient number and date of birth only)", () => {
    const labels = collectText(PrescriptionPdf({ prescriptions: [rx(1)] }));
    expect(labels).not.toContain("Address");
    expect(labels).not.toContain("Phone");
    expect(Object.keys(rx(1)).filter((key) => /address|phone|email/i.test(key))).toEqual([]);
  });

  it("is one page per prescription in a bundle, each with its own Rx number, code and dose", () => {
    const doc = PrescriptionPdf({ prescriptions: [rx(1), rx(2)] });
    expect(countPages(doc)).toBe(2);
    const text = collectText(doc).join("\n");
    expect(text).toContain("TRG-RX-2026-000361");
    expect(text).toContain("TRG-RX-2026-000362");
    expect(text).toContain("A1B2C2");
    expect(text).toContain("500 mg");
  });

  it("marks an amended prescription with its version and the reason", () => {
    const text = collectText(
      PrescriptionPdf({ prescriptions: [rx(1, { version: 2, amendmentReason: "Dose reduced" })] }),
    ).join("\n");
    expect(text).toContain("Version 2");
    expect(text).toContain("Dose reduced");
  });

  it("lists a prescription that could not be included on a final page, by drug name", () => {
    const doc = PrescriptionPdf({
      prescriptions: [rx(1)],
      skipped: [{ drugName: "Metformin", reason: "prescriber_unverified", message: "Contact your care team." }],
    });
    expect(countPages(doc)).toBe(2);
    const text = collectText(doc).join(" ").replace(/\s+/g, " ");
    expect(text).toContain("Not included in this document");
    expect(text).toContain("Metformin");
    expect(text).toContain("Contact your care team.");
  });

  it("has no extra page when nothing was skipped", () => {
    expect(countPages(PrescriptionPdf({ prescriptions: [rx(1)], skipped: [] }))).toBe(1);
  });

  it("prints the scan-to-check text only for a prescription that has a QR image", () => {
    const withQr = collectText(
      PrescriptionPdf({ prescriptions: [rx(1)], qrByMedicationId: { [rx(1).medicationId]: "data:image/png;base64,AAAA" } }),
    ).join(" ");
    expect(withQr).toContain(VERIFY_STATEMENT);
    const without = collectText(PrescriptionPdf({ prescriptions: [rx(1)] })).join(" ");
    expect(without).not.toContain(VERIFY_STATEMENT);
  });
});
