import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { GOOGLE_HEALTH_SOURCE_ID, googleHealthDeviceSource } from "./google-health-device-source";

describe("GoogleHealthDeviceSource stub (not wired)", () => {
  it("refuses every verb and returns no readings", async () => {
    expect((await googleHealthDeviceSource.connect({ patientId: "p", organisationId: "o" })).ok).toBe(false);
    expect((await googleHealthDeviceSource.sync(null, { since: new Date(0), until: new Date() })).ok).toBe(false);
    expect(googleHealthDeviceSource.normalise({ anything: 1 })).toEqual([]);
    expect((await googleHealthDeviceSource.revoke(null)).ok).toBe(false);
    expect(googleHealthDeviceSource.id).toBe(GOOGLE_HEALTH_SOURCE_ID);
  });

  it("is not exported from the package index, so nothing can register it by accident", () => {
    const index = readFileSync(join(fileURLToPath(new URL(".", import.meta.url)), "index.ts"), "utf8");
    expect(index).not.toContain("google-health-device-source");
  });
});
