import { MAX_PRIMARY_SECTIONS, PRIMARY_SECTIONS, SECTION_GROUP_ORDER, SECTIONS, SUPPORTER_PRIMARY_SECTIONS, tabIsActive } from "./sections";

describe("phone menu groups match the web side menu (2026-11-07)", () => {
  const order = (group: string) => SECTIONS.filter((s) => s.group === group && !s.more).map((s) => s.id);

  it("uses the web's six groups in the web's order", () => {
    expect(SECTION_GROUP_ORDER).toEqual(["top", "My health", "Healthcare", "My support", "Resources", "Account"]);
    // Sections are declared group by group, so the menu reads in that order.
    const seen = SECTIONS.map((s) => SECTION_GROUP_ORDER.indexOf(s.group));
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });

  it("puts the web's links in the web's order, with the phone-only screens behind More", () => {
    expect(order("top")).toEqual(["overview", "myActions"]);
    expect(order("My health")).toEqual(["myHealth", "vitals", "medications", "care", "programmes", "healthCheck", "prevention"]);
    expect(order("Healthcare")).toEqual(["labs", "appointments", "findASpecialist", "directory", "services", "screeningDays", "testingDays"]);
    expect(order("My support")).toEqual(["messages", "aiCoach", "family", "community", "supporting", "notificationSettings"]);
    expect(order("Resources")).toEqual(["learn", "wellness", "technicalSupport"]);
    expect(order("Account")).toEqual(["settings", "financialProfile", "devices", "privacy", "emergency"]);
  });

  it("keeps every screen reachable: each section once, none lost in the regroup", () => {
    const ids = SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(61);
    // lowCarb is reached only from the Medicines screen, by design.
    expect(ids).not.toContain("lowCarb");
  });
});

describe("patient bottom tabs (PD-01)", () => {
  it("are Home, My Health, Messages, Care plan, in that order", () => {
    expect(PRIMARY_SECTIONS.map((s) => [s.id, s.shortLabel])).toEqual([
      ["overview", "Home"],
      ["myHealth", "My Health"],
      ["messages", "Messages"],
      ["care", "Care plan"],
    ]);
    expect(PRIMARY_SECTIONS.length).toBe(MAX_PRIMARY_SECTIONS);
  });

  it("no longer flags Vitals or Medications as tabs; they sit near the top of My health in the menu", () => {
    for (const id of ["vitals", "medications"] as const) {
      const s = SECTIONS.find((x) => x.id === id);
      expect(s?.primary).toBeFalsy();
      expect(s?.group).toBe("My health");
      expect(s?.more).toBeFalsy();
    }
  });

  it("lights My Health on vitals, medicines, results, the timeline, the health summary and records (web tabAlsoActiveFor)", () => {
    const myHealth = PRIMARY_SECTIONS.find((s) => s.id === "myHealth")!;
    for (const id of ["myHealth", "vitals", "medications", "labs", "timeline", "healthSummary", "documents"] as const) {
      expect(tabIsActive(myHealth, id)).toBe(true);
    }
    expect(tabIsActive(myHealth, "messages")).toBe(false);
    // Exactly one tab lights for those screens, so More is not lit at the same time.
    expect(PRIMARY_SECTIONS.filter((s) => tabIsActive(s, "vitals")).map((s) => s.id)).toEqual(["myHealth"]);
    expect(PRIMARY_SECTIONS.some((s) => tabIsActive(s, "settings"))).toBe(false);
  });

  it("flags exactly the tabs it shows, so none is silently dropped", () => {
    expect(SECTIONS.filter((s) => s.primary).length).toBe(PRIMARY_SECTIONS.length);
  });

  it("leaves the supporter-only tabs unchanged", () => {
    expect(SUPPORTER_PRIMARY_SECTIONS.map((s) => s.id)).toEqual(["supporting", "messages", "family", "receipts"]);
  });
});
