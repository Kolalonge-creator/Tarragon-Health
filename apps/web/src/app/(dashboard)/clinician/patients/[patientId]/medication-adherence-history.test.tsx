import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";

const doseLog = jest.fn<(...a: unknown[]) => Promise<unknown>>();
const reasons = jest.fn<(...a: unknown[]) => Promise<unknown>>();
const week = jest.fn<(...a: unknown[]) => Promise<unknown>>();
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
jest.mock("@/lib/clinical/dose-log", () => ({ readMedicationDoseLogAudited: (...a: unknown[]) => doseLog(...a) }));
jest.mock("@/lib/clinical/weekly-adherence", () => ({ readWeeklyAdherence: (...a: unknown[]) => week(...a) }));
jest.mock("@/lib/clinical/dose-reasons", () => ({
  ...(jest.requireActual("@/lib/clinical/dose-reasons") as object),
  readDoseReasonsAudited: (...a: unknown[]) => reasons(...a),
}));

import { MedicationAdherenceHistory } from "./medication-adherence-history";

const entry = { id: "l1", status: "not_available", reason: null, logged_at: "2026-10-22T08:00:00Z", scheduled_for_date: null, scheduled_time: "08:00", logged_by_profile_id: null, medication: { drug_name: "Amlodipine" } };

async function html() {
  return renderToStaticMarkup(await MedicationAdherenceHistory({ patientId: "p1" }));
}

describe("clinician dose history shows the diverted private reason", () => {
  it("shows the reason read through the audited function", async () => {
    doseLog.mockResolvedValue({ status: "ok", rows: [entry] });
    week.mockResolvedValue({ status: "denied" });
    reasons.mockResolvedValue({ status: "ok", hasMore: false, rows: [{ medication_log_id: "l1", reason_code: "ran_out", status: "not_available", logged_at: entry.logged_at, scheduled_for_date: null, scheduled_time: "08:00" }] });
    expect(await html()).toContain("reason given: ran out, or could not afford it");
  });
  it("says so when the reasons cannot be read, rather than showing nothing", async () => {
    reasons.mockResolvedValue({ status: "error", message: "x" });
    expect(await html()).toContain("Private reasons for missed doses could not be loaded");
    reasons.mockResolvedValue({ status: "denied" });
    expect(await html()).toContain("not available to you");
  });
  it("says when older reasons are not listed", async () => {
    reasons.mockResolvedValue({ status: "ok", hasMore: true, rows: [] });
    expect(await html()).toContain("older ones are not listed");
  });
});
