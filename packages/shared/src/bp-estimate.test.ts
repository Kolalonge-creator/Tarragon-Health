import { describe, expect, it } from "@jest/globals";
import { BP_ESTIMATE_SOURCE, diagnosticBpReadings, isEstimateBpSource } from "./bp-estimate";

describe("a wearable blood pressure is an estimate, never a diagnostic number", () => {
  it("only the wearable source is an estimate", () => {
    expect(BP_ESTIMATE_SOURCE).toBe("wearable");
    expect(isEstimateBpSource("wearable")).toBe(true);
    for (const s of ["manual", "device", "photo_confirmed", "fhir_import", "cgm", "clinic", ""]) expect(isEstimateBpSource(s)).toBe(false);
  });

  it("a missing source is not an estimate, so an old or offline row is never hidden", () => {
    expect(isEstimateBpSource(null)).toBe(false);
    expect(isEstimateBpSource(undefined)).toBe(false);
  });

  it("drops the estimate and keeps cuff readings in order, untouched", () => {
    const rows = [{ id: 1, source: "manual" }, { id: 2, source: "wearable" }, { id: 3, source: "device" }, { id: 4 }, { id: 5, source: null }];
    expect(diagnosticBpReadings(rows).map((r) => r.id)).toEqual([1, 3, 4, 5]);
  });

  it("an empty list stays empty", () => {
    expect(diagnosticBpReadings([])).toEqual([]);
  });
});
