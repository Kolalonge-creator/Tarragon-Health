import { getLagosGreetingWord } from "./greeting";

describe("getLagosGreetingWord", () => {
  it("returns morning just after midnight Lagos time", () => {
    // 2026-08-17T00:00:00Z = 01:00 Lagos.
    expect(getLagosGreetingWord(new Date("2026-08-17T00:00:00Z"))).toBe("morning");
  });

  it("returns morning right up to the 12:00 Lagos boundary", () => {
    // 2026-08-17T10:59:00Z = 11:59 Lagos.
    expect(getLagosGreetingWord(new Date("2026-08-17T10:59:00Z"))).toBe("morning");
  });

  it("returns afternoon from the 12:00 Lagos boundary", () => {
    // 2026-08-17T11:00:00Z = 12:00 Lagos.
    expect(getLagosGreetingWord(new Date("2026-08-17T11:00:00Z"))).toBe("afternoon");
  });

  it("returns evening from the 17:00 Lagos boundary", () => {
    // 2026-08-17T16:00:00Z = 17:00 Lagos.
    expect(getLagosGreetingWord(new Date("2026-08-17T16:00:00Z"))).toBe("evening");
  });

  it("returns evening just before midnight Lagos time", () => {
    // 2026-08-17T22:59:00Z = 23:59 Lagos.
    expect(getLagosGreetingWord(new Date("2026-08-17T22:59:00Z"))).toBe("evening");
  });
});
