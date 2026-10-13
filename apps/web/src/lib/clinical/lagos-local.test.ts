import { parseLagosLocal } from "./lagos-local";

describe("parseLagosLocal", () => {
  it("reads a datetime-local value as Lagos time (UTC+1)", () => {
    expect(parseLagosLocal("2026-10-13T14:00")?.toISOString()).toBe("2026-10-13T13:00:00.000Z");
    expect(parseLagosLocal("2026-10-13T00:30:15")?.toISOString()).toBe("2026-10-12T23:30:15.000Z");
  });
  it("refuses anything that is not a real date and time", () => {
    for (const bad of ["", "tomorrow", "2026-10-13", "2026-13-40T10:00", "2026-10-13T25:00", "2026-10-13T10:00+02:00"]) {
      expect(parseLagosLocal(bad)).toBeNull();
    }
  });
});
