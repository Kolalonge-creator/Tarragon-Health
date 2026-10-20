import { activeWording } from "@tarragon/i18n";
import { BAND_UNIONS_MATCH, vitalSavedMessage } from "./bp-ack-message";

const RECEIVED = "Received by TarragonHealth. Your reading is saved in your record.";

describe("vitalSavedMessage", () => {
  it("the shared band and the web classifier's band are the same union (checked at compile time)", () => {
    expect(BAND_UNIONS_MATCH).toBe(true);
  });

  it("a non-blood-pressure reading keeps its plain line", () => {
    expect(vitalSavedMessage(undefined)).toBe("Reading logged.");
  });

  it("within and a little above say only that it was received: the web does not know a person's own target or pregnancy, so it never reassures", () => {
    for (const level of ["green", "amber", "unknown"] as const) expect(vitalSavedMessage(level)).toBe(RECEIVED);
  });

  it("a high reading adds the signed rest-and-measure-again wording, untouched", () => {
    const w = activeWording("TRI-005");
    expect(vitalSavedMessage("red")).toBe(`${RECEIVED} ${w.title}. ${w.body}`);
  });

  it("a crisis-range reading adds the signed emergency wording, untouched", () => {
    const w = activeWording("EMG-001");
    expect(vitalSavedMessage("emergency")).toBe(`${RECEIVED} ${w.title}. ${w.body}`);
  });

  it("never says a person looked at it and never gives a time of its own", () => {
    for (const level of ["green", "amber", "red", "emergency", "unknown"] as const) {
      // the signed wording itself may say "5 minutes" (TRI-005); strip it, then nothing of ours may carry a time or a review claim
      const mine = vitalSavedMessage(level).replace(/Check again in 5 minutes\. Sit quietly for 5 minutes[^.]*\./i, "").replace(/Get help now\.[^]*$/, "");
      expect(mine).not.toMatch(/\b(reviewed|has seen|have seen|looked at|within \d+|hours?|shortly|soon)\b/i);
    }
  });
});
