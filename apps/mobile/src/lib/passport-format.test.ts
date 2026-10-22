import { failedLoadMessage, formatPassportDate, formatPassportDateTime, staleNotice } from "./passport-format";

describe("passport formatting (S43m)", () => {
  it("formats in Lagos time and tolerates junk", () => {
    expect(formatPassportDate("2026-10-20T23:30:00Z")).toBe("21 Oct 2026");
    expect(formatPassportDate("nope")).toBe("");
    expect(formatPassportDate(null)).toBe("");
    expect(formatPassportDateTime("2026-10-20T10:05:00Z")).toContain("11:05");
  });

  it("says why a copy is old and when it was saved", () => {
    expect(staleNotice(true, "2026-10-20T10:05:00Z")).toBe("You are offline, so this is the copy saved on 20 Oct 2026, 11:05.");
    expect(staleNotice(false, "2026-10-20T10:05:00Z")).toContain("could not refresh");
    expect(staleNotice(true, null)).toContain("last copy saved on this phone");
  });

  it("never turns a failed read into an empty record", () => {
    expect(failedLoadMessage(true)).toContain("offline");
    expect(failedLoadMessage(false)).toContain("could not load");
  });
});
