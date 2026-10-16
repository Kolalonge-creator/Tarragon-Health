import { describe, expect, it } from "@jest/globals";
import { heliumHealthAdapter, HELIUM_HEALTH_SOURCE } from "./helium-health";

describe("Helium Health adapter seam", () => {
  it("is not configured, claims no integration, and does nothing when called", async () => {
    expect(heliumHealthAdapter.status).toBe("not_configured");
    expect(heliumHealthAdapter.sourceSystem).toBe(HELIUM_HEALTH_SOURCE);
    expect(await heliumHealthAdapter.fetchRecords({ patientReference: "x" })).toMatchObject({ ok: false, reason: "not_configured" });
    expect(await heliumHealthAdapter.sendSummary({ patientReference: "x", bundle: {} })).toMatchObject({ ok: false, reason: "not_configured" });
  });

  it("uses the same lower-case source name the consent and import functions normalise to", () => {
    expect(HELIUM_HEALTH_SOURCE).toBe(HELIUM_HEALTH_SOURCE.trim().toLowerCase());
  });
});
