import WORDING from "./clinical-wording.json";
import { activeOutreachDangerousReadingWording, OUTREACH_DANGEROUS_READING_SIGNED } from "./clinical-wording";

describe("OUT-001 on-site wording for a dangerous outreach reading", () => {
  const EXACT = {
    title: "This reading needs care today",
    steps: [
      "Stop the check for this person and stay with them.",
      "Tell them calmly: \"Your reading means you need to be seen at a hospital today. Please go now, and do not drive yourself.\"",
      "Help them find someone to go with them, or a way to get there. Do not give any medicine.",
      "If they have chest pain, trouble breathing, weakness on one side of the body, confusion or fainting, get emergency help straight away.",
      "Their app is showing them the same advice.",
    ],
  };

  it("is the exact text the CMO signed on 2026-11-04, version 1", () => {
    expect(OUTREACH_DANGEROUS_READING_SIGNED?.on).toBe("2026-11-04");
    expect(OUTREACH_DANGEROUS_READING_SIGNED?.version).toBe(1);
    expect(OUTREACH_DANGEROUS_READING_SIGNED?.by.length).toBeGreaterThan(0);
    expect(WORDING.outreachDangerousReading.proposed).toEqual(EXACT);
    expect(WORDING.outreachDangerousReading.current).toEqual(EXACT);
  });

  it("shows the same words signed or not", () => {
    expect(activeOutreachDangerousReadingWording(null)).toEqual(EXACT);
    expect(activeOutreachDangerousReadingWording()).toEqual(EXACT);
  });

  it("says nothing that is only true of a high reading, prints no phone number, and does not shout", () => {
    const all = [EXACT.title, ...EXACT.steps].join(" ");
    expect(all).not.toMatch(/high enough|too high/i);
    expect(all).not.toMatch(/\b\d{3}\b/);
    expect(all).not.toMatch(/WARNING|URGENT/);
  });
});
