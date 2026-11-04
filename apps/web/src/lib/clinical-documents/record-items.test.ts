/** @jest-environment node */
import { describe, expect, it, jest } from "@jest/globals";

jest.mock("server-only", () => ({}));
jest.mock("@/lib/supabase/sign-storage-paths", () => ({ signStoragePaths: jest.fn() }));

import { groupByPipeline, PATIENT_STATUS, previousOfSameKind, type RecordItemRow } from "./record-items";
import { worklistItemHref } from "../security/worklists";

const row = (over: Partial<RecordItemRow>): RecordItemRow =>
  ({ id: "x", kind_code: null, kind_group: null, pipeline: "unsorted", uploaded_at: "2026-11-01T10:00:00Z", investigation_date: null, is_superseded: false, ...over }) as RecordItemRow;

describe("the record list", () => {
  it("groups documents by kind in a fixed order and drops empty groups", () => {
    const groups = groupByPipeline([row({ id: "a", pipeline: "narrative" }), row({ id: "b", pipeline: "lab" }), row({ id: "c", pipeline: "lab" })]);
    expect(groups.map((g) => [g.pipeline, g.items.length])).toEqual([["lab", 2], ["narrative", 1]]);
  });

  it("finds earlier documents of the same kind, newest first, and ignores later, replaced or other kinds", () => {
    const current = row({ id: "now", kind_code: "imaging.mammography", kind_group: "imaging", uploaded_at: "2026-11-01T00:00:00Z" });
    const items = [
      current,
      row({ id: "2024", kind_code: "imaging.mammography", kind_group: "imaging", uploaded_at: "2024-10-01T00:00:00Z", investigation_date: "2024-09-28" }),
      row({ id: "2025", kind_code: "imaging.mammography", kind_group: "imaging", uploaded_at: "2025-10-01T00:00:00Z", investigation_date: "2025-09-30" }),
      row({ id: "later", kind_code: "imaging.mammography", kind_group: "imaging", uploaded_at: "2026-11-02T00:00:00Z" }),
      row({ id: "replaced", kind_code: "imaging.mammography", kind_group: "imaging", uploaded_at: "2025-01-01T00:00:00Z", is_superseded: true }),
      row({ id: "lab", kind_code: "lab.haematology", kind_group: "lab", uploaded_at: "2025-01-01T00:00:00Z" }),
    ];
    expect(previousOfSameKind(items, current).map((i) => i.id)).toEqual(["2025", "2024"]);
  });

  it("decides 'earlier' by test date, not by when the file was added", () => {
    const newer = row({ id: "2026", kind_code: "imaging.mammography", uploaded_at: "2026-10-01T00:00:00Z", investigation_date: "2026-09-30" });
    const older = row({ id: "2023", kind_code: "imaging.mammography", uploaded_at: "2026-10-05T00:00:00Z", investigation_date: "2023-09-01" });
    expect(previousOfSameKind([newer, older], newer).map((i) => i.id)).toEqual(["2023"]);
    expect(previousOfSameKind([newer, older], older)).toEqual([]);
  });

  it("only promises a doctor when one has been asked to look", () => {
    expect(PATIENT_STATUS.doctor_review_required).toMatch(/doctor/);
    for (const s of ["processed", "awaiting_verification", "uploaded"]) expect(PATIENT_STATUS[s]).not.toMatch(/doctor/i);
  });

  it("uses plain words for every intake status", () => {
    for (const s of ["uploaded", "classifying", "needs_type_confirmation", "processing", "processed", "awaiting_verification", "doctor_review_required", "reviewed", "processing_failed", "superseded"]) {
      expect(PATIENT_STATUS[s]).toBeTruthy();
    }
  });

  it("opens an uploaded report from the shared queue in the viewer", () => {
    expect(worklistItemHref("uploaded_documents", "doc-1", "pat-1")).toBe("/clinician/patients/pat-1/records/doc-1");
    expect(worklistItemHref("lab_results", "doc-1", "pat-1")).toBe("/clinician/patients/pat-1");
  });
});
