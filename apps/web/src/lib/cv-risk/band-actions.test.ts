import { en } from "@tarragon/i18n";
import { bandActionText, bandActions } from "./band-actions";

describe("risk band actions (S47, unsigned config, the app never prescribes)", () => {
  it("has the five bands and each leads to the chosen action", () => {
    expect(Object.keys(bandActions())).toEqual(["lt5", "5to10", "10to20", "20to30", "ge30"]);
    expect(bandActionText("lt5")).toBe("Keep up healthy habits. We suggest checking this again in 12 months.");
    expect(bandActionText("5to10")).toBe("Keep up healthy habits and have your blood pressure checked every 6 months.");
    expect(bandActionText("10to20")).toMatch(/care team will review this with you within 4 weeks.*A doctor decides whether any medicine.*every 3 months/);
    expect(bandActionText("20to30")).toMatch(/doctor will review this with you within 2 weeks.*every 3 months/);
    expect(bandActionText("ge30")).toMatch(/doctor will review this with you within 1 week\./);
  });

  it("says review, never start a medicine (INV-02), and uses no em dash", () => {
    for (const k of Object.keys(bandActions())) {
      const text = bandActionText(k) ?? "";
      expect(text).not.toMatch(/start|prescrib|begin (a )?medic|take (a )?medic/i);
      expect(text).not.toContain("\u2014");
    }
  });

  it("an unknown band has no action rather than a guess", () => {
    expect(bandActionText("nope")).toBeNull();
  });

  it("every copy key in the config exists in the catalogue", () => {
    for (const a of Object.values(bandActions())) expect(Object.keys(en)).toContain(a.copyKey);
  });
});
