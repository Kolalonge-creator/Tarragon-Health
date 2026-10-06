import { describe, expect, it } from "@jest/globals";
import { safeRotaReturnTo, withOutcome } from "./return-to";
import { defaultStartInput, formatLagos, formatLagosRange, lagosLocalToIso } from "./time";
import { RotaError, rotaErrorMessage, rpcParsed, rpcVoid, toRotaError } from "./rpc";
import { colleaguesSchema, leadOverviewSchema, myBlocksSchema, rotaOverviewSchema } from "./schemas";
import { z } from "zod";

describe("return path guard", () => {
  it("only honours the rota and on-call pages", () => {
    expect(safeRotaReturnTo("/admin/rota", "/clinician/rota")).toBe("/admin/rota");
    expect(safeRotaReturnTo("/clinician/team-rota?ok=1", "/admin/rota")).toBe("/clinician/team-rota");
    expect(safeRotaReturnTo("/clinician/rota", "/admin/rota")).toBe("/clinician/rota");
    expect(safeRotaReturnTo("/clinician/on-call", "/admin/rota")).toBe("/clinician/on-call");
  });
  it("is not an open redirect", () => {
    for (const bad of ["https://evil.example/admin/rota", "//evil.example", "/admin/rota/../../login", "/admin/rota%2f..", "/admin\\rota", "/other", null]) {
      expect(safeRotaReturnTo(bad as FormDataEntryValue | null, "/admin/rota")).toBe("/admin/rota");
    }
  });
  it("carries the outcome on the query string, encoded", () => {
    expect(withOutcome("/admin/rota", { ok: "Shift saved." })).toBe("/admin/rota?ok=Shift%20saved.");
    expect(withOutcome("/admin/rota", { error: "a & b" })).toBe("/admin/rota?error=a%20%26%20b");
  });
});

describe("Lagos time", () => {
  it("converts a form value with the fixed +01:00 offset", () => {
    expect(lagosLocalToIso("2026-10-07T08:00")).toBe("2026-10-07T07:00:00.000Z");
  });
  it("rejects anything that is not a real local time", () => {
    for (const bad of ["", "2026-10-07", "2026-13-40T99:99", "tomorrow", "2026-10-07T08:00:00"]) expect(lagosLocalToIso(bad)).toBeNull();
  });
  it("shows Lagos time whatever the viewer's zone", () => {
    expect(formatLagos("2026-10-07T07:00:00.000Z")).toContain("08:00");
    expect(formatLagosRange("2026-10-07T07:00:00.000Z", "2026-10-07T19:00:00.000Z")).toMatch(/08:00 to 20:00$/);
  });
  it("suggests the first whole hour that is at least an hour away, in Lagos time", () => {
    expect(defaultStartInput(new Date("2026-10-07T07:20:00.000Z"))).toBe("2026-10-07T10:00");
    expect(defaultStartInput(new Date("2026-10-07T07:00:00.000Z"))).toBe("2026-10-07T09:00");
  });
});

describe("rpc wrapper", () => {
  const client = (result: { data: unknown; error: { message: string; code?: string } | null }) => ({ rpc: async () => result });
  it("lets a message written for people through and hides everything else", () => {
    expect(toRotaError({ message: "this overlaps hours you already declared", code: "23P01" }).message).toBe("this overlaps hours you already declared");
    expect(toRotaError({ message: "relation x does not exist", code: "42P01" }).message).toMatch(/Something went wrong/);
    expect(toRotaError({ message: "availability_too_short", code: "22023" }).message).toBe("Hours must be at least two hours long.");
    expect(toRotaError({ message: "availability_on_the_rota: ask for a swap instead", code: "22023" }).message).toMatch(/Ask a colleague/);
    expect(toRotaError({ message: "queue_not_eligible", code: "42501" }).message).toMatch(/credentials need attention/);
    expect(toRotaError({ message: "boom" }).code).toBeUndefined();
    expect(rotaErrorMessage(new RotaError("a", undefined))).toBe("a");
    expect(rotaErrorMessage(new Error("raw"))).toMatch(/Something went wrong/);
  });
  it("parses what comes back and refuses a surprise", async () => {
    expect(await rpcParsed(client({ data: ["x"], error: null }), "f", {}, z.array(z.string()))).toEqual(["x"]);
    await expect(rpcParsed(client({ data: 5, error: null }), "f", {}, z.array(z.string()))).rejects.toThrow(/not what we expected/);
    await expect(rpcParsed(client({ data: null, error: { message: "no", code: "42501" } }), "f", {}, z.string())).rejects.toThrow("no");
  });
  it("rpcVoid throws on error and is silent otherwise", async () => {
    await expect(rpcVoid(client({ data: null, error: null }), "f", {})).resolves.toBeUndefined();
    await expect(rpcVoid(client({ data: null, error: { message: "nope", code: "22023" } }), "f", {})).rejects.toThrow("nope");
  });
});

describe("answers from the database are parsed, not trusted", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  it("accepts a real overview", () => {
    const parsed = rotaOverviewSchema.parse({
      status: { covered_now: true, current_primary: "A", current_backup: "B", eligible_on_call_clinicians: 3, enough_clinicians: true, horizon_days: 14, gaps: [{ from: "2026-10-08T00:00:00Z", to: "2026-10-08T06:00:00Z", kind: "uncovered" }] },
      shifts: [{ id, starts_at: "2026-10-07T07:00:00Z", ends_at: "2026-10-07T19:00:00Z", primary_id: id, primary_name: "A", backup_id: null, backup_name: null, override_reason: null }],
      pending_blocks: [], swaps: [], clinicians: [{ id, name: "A", employment_type: "employed" }],
    });
    expect(parsed.shifts[0]?.warnings).toEqual([]);
  });
  it("refuses a malformed overview", () => {
    expect(rotaOverviewSchema.safeParse({ status: {}, shifts: "x" }).success).toBe(false);
  });
  it("parses the smaller reads", () => {
    expect(leadOverviewSchema.parse({ leads: [], unassigned: [{ patient_id: id, since: "2026-10-07T07:00:00Z" }], conflicts_open: 0 }).unassigned).toHaveLength(1);
    expect(colleaguesSchema.parse([{ clinician_id: id, name: null }])).toHaveLength(1);
    expect(myBlocksSchema.safeParse([{ id, kind: "dinner", state: "declared", starts_at: "2026-10-07T07:00:00Z", ends_at: "2026-10-07T09:00:00Z", minimum_guarantee_eligible: false }]).success).toBe(false);
  });
});
