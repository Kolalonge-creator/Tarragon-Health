import { describe, expect, it } from "@jest/globals";
import { openPatientRecord } from "./open-patient-record";

const client = (result: { data: unknown; error: { message: string; code?: string } | null }) => ({ rpc: async () => result });

describe("openPatientRecord", () => {
  it("returns the basis and the window when the opening is logged", async () => {
    const r = await openPatientRecord(client({ data: { opened: true, basis: "open", expires_at: "2026-10-08T00:00:00Z" }, error: null }), "p");
    expect(r).toEqual({ status: "opened", basis: "open", expiresAt: "2026-10-08T00:00:00Z" });
  });
  it("treats a non-clinician and an unknown patient as not applicable, not as a failure", async () => {
    expect(await openPatientRecord(client({ data: null, error: { message: "x", code: "42501" } }), "p")).toEqual({ status: "not_applicable" });
    expect(await openPatientRecord(client({ data: null, error: { message: "x", code: "P0002" } }), "p")).toEqual({ status: "not_applicable" });
  });
  it("reports any other error as failed with its message (never swallowed)", async () => {
    expect(await openPatientRecord(client({ data: null, error: { message: "boom", code: "XX000" } }), "p")).toEqual({ status: "failed", message: "boom" });
  });
  it("reports a malformed answer as failed", async () => {
    expect((await openPatientRecord(client({ data: { opened: false }, error: null }), "p")).status).toBe("failed");
    expect((await openPatientRecord(client({ data: null, error: null }), "p")).status).toBe("failed");
  });
});
