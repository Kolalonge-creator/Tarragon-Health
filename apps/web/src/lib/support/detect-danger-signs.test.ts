import { describe, expect, it } from "@jest/globals";
import { detectDangerSigns } from "./detect-danger-signs";

describe("detectDangerSigns", () => {
  it("matches chest pain described in an ordinary sentence", () => {
    expect(detectDangerSigns("I'm having severe chest pain and it won't go away")).toEqual(["chest_pain"]);
  });

  it("matches case-insensitively", () => {
    expect(detectDangerSigns("SEVERE CHEST PAIN since this morning")).toEqual(["chest_pain"]);
  });

  it("can match more than one sign in the same text", () => {
    const signs = detectDangerSigns("I have chest pain and I can't breathe");
    expect(signs).toContain("chest_pain");
    expect(signs).toContain("trouble_breathing");
  });

  it("returns an empty array for an ordinary support request", () => {
    expect(detectDangerSigns("My appointment reschedule button doesn't work")).toEqual([]);
  });

  it("does not match on an unrelated use of a similar word", () => {
    expect(detectDangerSigns("I paid for my appointment but the payment page crashed")).toEqual([]);
  });
});
