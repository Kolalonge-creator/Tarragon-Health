import { describe, expect, it } from "@jest/globals";
import { fetchMyExport } from "./fetch-my-export";

const client = (r: { data: unknown; error: { message: string; code?: string } | null }) => ({ rpc: async () => r });

describe("fetchMyExport", () => {
  it("returns the payload when the export is approved", async () => {
    expect(await fetchMyExport(client({ data: { tables: {} }, error: null }))).toEqual({ status: "ok", payload: { tables: {} } });
  });
  it("reports a refusal as not approved, never as an empty export", async () => {
    expect(await fetchMyExport(client({ data: null, error: { message: "no approved export request", code: "42501" } }))).toEqual({ status: "not_approved" });
  });
  it("reports any other error or a malformed answer as failed", async () => {
    expect(await fetchMyExport(client({ data: null, error: { message: "boom", code: "XX000" } }))).toEqual({ status: "failed", message: "boom" });
    expect((await fetchMyExport(client({ data: null, error: null }))).status).toBe("failed");
    expect((await fetchMyExport(client({ data: [], error: null }))).status).toBe("failed");
  });
});
