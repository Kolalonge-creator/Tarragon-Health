import { describe, expect, it } from "@jest/globals";
import { ANALYTICS_SECTIONS, OVERVIEW_SECTION } from "@/lib/analytics/sections";
import { APP_ICON } from "@/lib/icons";
import { ANALYTICS_TABS } from "./analytics-nav";

/**
 * The admin pill-tab bar and the analyst sidebar are the same console. They
 * were once two hand-maintained lists, and the drift hid /analytics/capacity
 * and /analytics/safety from the analyst role entirely. These assertions fail
 * if either list grows an entry the other does not have.
 */
describe("analytics navigation", () => {
  it("offers a tab for every analytics section", () => {
    const tabHrefs = new Set(ANALYTICS_TABS.map((t) => t.href));
    for (const section of ANALYTICS_SECTIONS) {
      expect(tabHrefs.has(section.href)).toBe(true);
    }
  });

  it("offers no tab that is not a section (or the overview)", () => {
    const known = new Set<string>([
      OVERVIEW_SECTION.href,
      ...ANALYTICS_SECTIONS.map((s) => s.href),
    ]);
    for (const tab of ANALYTICS_TABS) {
      expect(known.has(tab.href)).toBe(true);
    }
  });

  it("links each route exactly once", () => {
    const hrefs = ANALYTICS_TABS.map((t) => t.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("names an icon the shared registry can resolve", () => {
    for (const tab of ANALYTICS_TABS) {
      expect(APP_ICON[tab.icon]).toBeDefined();
    }
  });
});
