import { describe, expect, it } from "@jest/globals";
import { consentStateFor, outstandingRequired, type ConsentEventRow } from "./consent-state";

const row = (consent_type: string, version: string, action: string, created_at: string): ConsentEventRow => ({
  consent_type,
  version,
  action,
  created_at,
});
const V = { consent_type: "research", version: "v2" };

describe("consentStateFor", () => {
  it("never answered", () => expect(consentStateFor([], V)).toBe("never"));

  it("granted when the current version was accepted", () => {
    expect(consentStateFor([row("research", "v2", "accepted", "2026-10-01T10:00:00Z")], V)).toBe("granted");
  });

  it("a withdrawal after the acceptance ends it (the bug: this used to read as granted)", () => {
    const rows = [row("research", "v2", "accepted", "2026-10-01T10:00:00Z"), row("research", "v2", "withdrawn", "2026-10-02T10:00:00Z")];
    expect(consentStateFor(rows, V)).toBe("withdrawn");
  });

  it("a re-acceptance after the withdrawal is granted again", () => {
    const rows = [
      row("research", "v2", "accepted", "2026-10-01T10:00:00Z"),
      row("research", "v2", "withdrawn", "2026-10-02T10:00:00Z"),
      row("research", "v2", "accepted", "2026-10-03T10:00:00Z"),
    ];
    expect(consentStateFor(rows, V)).toBe("granted");
  });

  it("an older version in force is not the current one", () => {
    expect(consentStateFor([row("research", "v1", "accepted", "2026-09-01T10:00:00Z")], V)).toBe("older_version");
  });

  it("an older version that was withdrawn is withdrawn, not older_version", () => {
    const rows = [row("research", "v1", "accepted", "2026-09-01T10:00:00Z"), row("research", "v1", "withdrawn", "2026-09-02T10:00:00Z")];
    expect(consentStateFor(rows, V)).toBe("withdrawn");
  });

  it("another purpose's rows never count", () => {
    expect(consentStateFor([row("marketing", "v2", "accepted", "2026-10-01T10:00:00Z")], V)).toBe("never");
  });

  it("orders by time, not by array position", () => {
    const rows = [row("research", "v2", "withdrawn", "2026-10-02T10:00:00Z"), row("research", "v2", "accepted", "2026-10-01T10:00:00Z")];
    expect(consentStateFor(rows, V)).toBe("withdrawn");
  });
});

describe("outstandingRequired", () => {
  const versions = [
    { consent_type: "data_processing", version: "d1", is_optional: false },
    { consent_type: "research", version: "r1", is_optional: true },
    { consent_type: "telehealth", version: "t1" },
  ];

  it("lists required purposes that are not in force and never lists an optional one", () => {
    expect(outstandingRequired(versions, []).map((v) => v.consent_type)).toEqual(["data_processing", "telehealth"]);
  });

  it("a withdrawn required purpose comes back as outstanding", () => {
    const rows = [
      row("data_processing", "d1", "accepted", "2026-10-01T10:00:00Z"),
      row("telehealth", "t1", "accepted", "2026-10-01T10:00:00Z"),
      row("telehealth", "t1", "withdrawn", "2026-10-02T10:00:00Z"),
    ];
    expect(outstandingRequired(versions, rows).map((v) => v.consent_type)).toEqual(["telehealth"]);
  });

  it("nothing outstanding once every required purpose is in force", () => {
    const rows = [row("data_processing", "d1", "accepted", "2026-10-01T10:00:00Z"), row("telehealth", "t1", "accepted", "2026-10-01T10:00:00Z")];
    expect(outstandingRequired(versions, rows)).toEqual([]);
  });
});
