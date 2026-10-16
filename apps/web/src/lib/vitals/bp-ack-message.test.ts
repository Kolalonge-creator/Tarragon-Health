import { activeWording } from "@tarragon/i18n";
import { vitalSavedMessage } from "./bp-ack-message";

describe("vitalSavedMessage", () => {
  it("a non-blood-pressure reading keeps its plain line", () => {
    expect(vitalSavedMessage(undefined)).toBe("Reading logged.");
  });

  it("a blood pressure reading says it was received, then the signed wording for its band, untouched", () => {
    for (const [level, code] of [
      ["green", "TRI-001"],
      ["amber", "TRI-003"],
      ["red", "TRI-005"],
      ["emergency", "TRI-005"],
    ] as const) {
      const m = vitalSavedMessage(level);
      const w = activeWording(code);
      expect(m.startsWith("Received by TarragonHealth. Your reading is saved in your record.")).toBe(true);
      expect(m).toContain(`${w.title}. ${w.body}`);
    }
  });

  it("an unknown band says only that it was received", () => {
    expect(vitalSavedMessage("unknown")).toBe("Received by TarragonHealth. Your reading is saved in your record.");
  });

  it("never says a person looked at it and never gives a time", () => {
    for (const level of ["green", "amber", "red", "emergency", "unknown"] as const) {
      const m = vitalSavedMessage(level).replace(/Check again in 5 minutes\. Sit quietly for 5 minutes[^.]*\./i, "");
      expect(m).not.toMatch(/\b(reviewed|has seen|have seen|looked at|within \d+|hours?|shortly|soon)\b/i);
    }
  });
});
