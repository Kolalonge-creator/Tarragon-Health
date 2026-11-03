/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "@jest/globals";
import { parsePatientHeader, PatientRecordLink, patientRecordHref } from "./patient-record-link";

const PATIENT = "8f1c1d2e-3b4a-4c5d-8e6f-7a8b9c0d1e2f";

/**
 * Founder ask, 2026-11-03, after the first live video consultation: the doctor's consultation list showed only a first
 * name and no way to the record. The name must link to /clinician/patients/<id>, and must never be shown without a real
 * row behind it (no guessed name, no link to nowhere).
 */
describe("PatientRecordLink", () => {
  it("links the full name to the patient's record", () => {
    const html = renderToStaticMarkup(<PatientRecordLink header={{ patient_id: PATIENT, patient_full_name: "Adaeze Okonkwo", patient_is_test: false }} />);
    expect(html).toContain(`href="${patientRecordHref(PATIENT)}"`);
    expect(html).toContain("/clinician/patients/" + PATIENT);
    expect(html).toContain("Adaeze Okonkwo");
    expect(html).not.toContain("Test account");
  });

  it("badges a test account next to the name (INV-13)", () => {
    const html = renderToStaticMarkup(<PatientRecordLink header={{ patient_id: PATIENT, patient_full_name: "First Patient", patient_is_test: true }} />);
    expect(html).toContain("Test account");
    expect(html).toContain(`href="${patientRecordHref(PATIENT)}"`);
  });

  it("renders 'Patient' with no link when there is no real row or no name", () => {
    expect(renderToStaticMarkup(<PatientRecordLink header={null} />)).not.toContain("href=");
    expect(renderToStaticMarkup(<PatientRecordLink header={null} />)).toContain("Patient");
    const blank = renderToStaticMarkup(<PatientRecordLink header={{ patient_id: PATIENT, patient_full_name: "  ", patient_is_test: false }} />);
    expect(blank).not.toContain("href=");
  });

  it("parses only a real header: a null read, a missing id or a non-uuid id give null", () => {
    expect(parsePatientHeader(null)).toBeNull();
    expect(parsePatientHeader({ patient_full_name: "X" })).toBeNull();
    expect(parsePatientHeader({ patient_id: "not-a-uuid", patient_full_name: "X" })).toBeNull();
    expect(parsePatientHeader({ patient_id: PATIENT, patient_full_name: "X", patient_is_test: true })).toEqual({ patient_id: PATIENT, patient_full_name: "X", patient_is_test: true });
    // a list row carries extra keys; they are ignored, not refused
    expect(parsePatientHeader({ encounter_id: "e", patient_id: PATIENT, patient_full_name: "X", patient_is_test: false, patient_first_name: "X" })?.patient_id).toBe(PATIENT);
  });
});

function sourceOf(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", "..", "app", "(dashboard)", "clinician", ...segments), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

describe("the doctor's consultation pages name the patient through the one component", () => {
  it("the consultations list renders the name link from each row", () => {
    const page = sourceOf("consultations", "page.tsx");
    expect(page).toContain("<PatientRecordLink header={parsePatientHeader(r)}");
    expect(page).not.toMatch(/r\.patient_first_name \|\| "Patient"/);
  });

  it("the pre-call page reads consultation_patient_header and renders the link", () => {
    const page = sourceOf("precall", "[encounterId]", "page.tsx");
    expect(page).toContain('rpc("consultation_patient_header"');
    expect(page).toContain("<PatientRecordLink header={header}");
  });

  it("the room page reads consultation_patient_header and renders the link", () => {
    const page = sourceOf("consultation", "[encounterId]", "page.tsx");
    expect(page).toContain('rpc("consultation_patient_header"');
    expect(page).toContain("<PatientRecordLink header={header}");
  });
});
