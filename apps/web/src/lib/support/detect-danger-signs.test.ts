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
    expect(detectDangerSigns("The app crashes every time I try to log in")).toEqual([]);
  });

  it("does not match on an unrelated use of a similar word", () => {
    expect(detectDangerSigns("The app crashed while I was on the payment page")).toEqual([]);
  });
});
