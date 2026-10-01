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

import { CONTACT_STATEMENT, NOT_CONTROLLED_STATEMENT, PrescriptionPdf, RECORD_STATEMENT, REPEAT_STATEMENT, VERIFY_STATEMENT, verifyLinkText } from "./prescription-document";
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
  patientAge: 41,
  patientSex: "female",
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
  signatureImage: null,
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
    ).join(" ").replace(/\s+/g, " ");
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

  it("always prints the optional check wording (scan or contact), and an image only when a QR was rendered", () => {
    const withQr = PrescriptionPdf({ prescriptions: [rx(1)], qrByMedicationId: { [rx(1).medicationId]: "data:image/png;base64,AAAA" } });
    const without = PrescriptionPdf({ prescriptions: [rx(1)] });
    expect(collectText(withQr).join(" ")).toContain(VERIFY_STATEMENT);
    expect(collectText(without).join(" ")).toContain(VERIFY_STATEMENT);
    const countImages = (node: unknown): number => {
      if (node == null || typeof node !== "object") return 0;
      if (Array.isArray(node)) return node.reduce((n: number, c) => n + countImages(c), 0);
      const el = node as ReactElement<{ children?: unknown; src?: string }>;
      if (typeof el.type === "function") return countImages((el.type as (p: unknown) => unknown)(el.props));
      return (el.type === "Image" && typeof el.props?.src === "string" && el.props.src.startsWith("data:") ? 1 : 0) + countImages(el.props?.children);
    };
    expect(countImages(withQr)).toBe(1);
    expect(countImages(without)).toBe(0);
  });

  it("is a text prescription first: company, signature, patient details and medicine are all printed, and the scan is only an optional extra", () => {
    const text = collectText(
      PrescriptionPdf({
        prescriptions: [rx(1)],
        letterhead: { tradingName: "TarragonHealth", legalName: "Tarragon Health Limited", rcNumber: "1234567", address: "Victoria Island, Lagos", email: "admin@tarragonhealth.ng", phone: "+234 806 119 7940" },
      }),
    ).join(" ").replace(/\s+/g, " ");
    for (const expected of [
      "TarragonHealth",
      "Tarragon Health Limited",
      "RC 1234567",
      "Victoria Island, Lagos",
      "PRESCRIPTION",
      "41 years",
      "Female",
      "Rx",
      "ELECTRONICALLY SIGNED",
      "Dr. Ada Longe",
      "MDCN 123456",
      "Optional: scan",
    ]) {
      expect(text).toContain(expected);
    }
    expect(VERIFY_STATEMENT).toMatch(/^Optional/);
  });

  it("falls back to the TarragonHealth name when no company details are available", () => {
    const text = collectText(PrescriptionPdf({ prescriptions: [rx(1)] })).join(" ");
    expect(text).toContain("TarragonHealth");
    expect(text).not.toContain("RC ");
  });

  it("prints the signature image above the signature line only when the prescriber has one", () => {
    const imagesWithSrc = (node: unknown, prefix: string): number => {
      if (node == null || typeof node !== "object") return 0;
      if (Array.isArray(node)) return node.reduce((n: number, c) => n + imagesWithSrc(c, prefix), 0);
      const el = node as ReactElement<{ children?: unknown; src?: unknown }>;
      if (typeof el.type === "function") return imagesWithSrc((el.type as (p: unknown) => unknown)(el.props), prefix);
      return (el.type === "Image" && typeof el.props?.src === "string" && el.props.src.startsWith(prefix) ? 1 : 0) + imagesWithSrc(el.props?.children, prefix);
    };
    const signed = PrescriptionPdf({ prescriptions: [rx(1, { signatureImage: "data:image/png;base64,SIG" })] });
    const unsigned = PrescriptionPdf({ prescriptions: [rx(1)] });
    expect(imagesWithSrc(signed, "data:image/png;base64,SIG")).toBe(1);
    expect(imagesWithSrc(unsigned, "data:image/png;base64,SIG")).toBe(0);
    expect(collectText(signed).join(" ")).toContain("ELECTRONICALLY SIGNED");
  });

  it("has a pharmacist panel for a pharmacy that cannot scan: the check address as text, a phone and email, and a request to record the supply", () => {
    const token = "ab12".repeat(16);
    const text = collectText(
      PrescriptionPdf({
        prescriptions: [rx(1, { publicToken: token })],
        letterhead: { tradingName: "TarragonHealth", legalName: null, rcNumber: null, address: null, email: "pharmacy@example.ng", phone: "+234 700 000 0000" },
      }),
    ).join(" ").replace(/\s+/g, " ");
    expect(text).toContain("FOR THE PHARMACIST");
    expect(text).toContain(`tarragonhealth.ng/verify-rx/${token}`);
    expect(verifyLinkText(token)).not.toMatch(/^https?:/);
    expect(text).toContain(`${CONTACT_STATEMENT} +234 700 000 0000 or pharmacy@example.ng`);
    expect(text).toContain(RECORD_STATEMENT);
    expect(text).toContain("quoting the Rx number and verification code");
    expect(text).toContain("TRG-RX-2026-000361");
    expect(text).toContain("A1B2C1");
  });

  it("prints no check link for a prescription that has no token, but still prints the contact route", () => {
    const text = collectText(PrescriptionPdf({ prescriptions: [rx(1, { publicToken: null })] })).join(" ");
    expect(text).not.toContain("verify-rx/");
    expect(text).toContain(CONTACT_STATEMENT);
  });
});
