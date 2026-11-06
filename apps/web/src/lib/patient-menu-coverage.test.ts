import { getNavSections, primaryNavItems, MAX_PRIMARY_NAV_ITEMS } from "./navigation";
import { buildPatientSearchIndex } from "./patient-search";
import { MY_HEALTH_RELATED_LINKS } from "@/app/(dashboard)/patient/my-health/related-links";
import { PATIENT_PAGE_GATES } from "@tarragon/shared";

/**
 * Patient dashboard 2.0, slice C (PD-01). The patient menu was regrouped from five bands (43 links) into six groups. No page may fall
 * out of reach in the move: every address the old menu listed must still be in the new menu or in patient search.
 */
const OLD_PATIENT_MENU = [
  "/patient", "/patient/actions", "/patient/vitals", "/patient/medications", "/patient/labs", "/patient/messages",
  "/patient/programmes", "/patient/pathway", "/patient/appointments", "/patient/health-summary", "/patient/my-health",
  "/patient/health-records", "/patient/prevention", "/patient/womens-health", "/patient/sexual-health", "/patient/wellbeing",
  "/patient/self-help", "/patient/health-check", "/patient/find-a-specialist", "/patient/healthy-ageing", "/patient/devices",
  "/patient/lifestyle", "/patient/weight-management", "/patient/learn", "/patient/wellness", "/patient/care",
  "/patient/subscription", "/patient/membership", "/patient/family", "/patient/community", "/patient/supporting",
  "/patient/family/health-reports", "/patient/screening-days", "/patient/testing-days", "/patient/calendar",
  "/patient/health-passport", "/patient/financial-profile", "/patient/notification-settings", "/patient/support",
  "/patient/profile", "/patient/privacy", "/patient/emergency-card",
] as const;

const menu = (communityOpen: boolean) => getNavSections("patient", true, { communityOpen });
const hrefs = (communityOpen: boolean) => menu(communityOpen).flatMap((s) => s.items.map((i) => i.href));

describe("patient menu regroup keeps every page reachable", () => {
  // Search only: the menu's own links are not counted twice, so a page that left the menu must be a curated search entry.
  const curated = new Set(buildPatientSearchIndex([]).map((e) => e.href));
  const reachable = new Set([...hrefs(true), ...curated]);
  it.each(OLD_PATIENT_MENU)("%s is still in the menu or in search", (href) => expect(reachable.has(href)).toBe(true));

  it("the record pages that left the menu are one tap from the My health record hub, and in search", () => {
    const hub = new Set<string>(MY_HEALTH_RELATED_LINKS.map((l) => l.href));
    const search = new Set(buildPatientSearchIndex(menu(false)).map((e) => e.href));
    for (const href of ["/patient/health-summary", "/patient/health-records"]) {
      expect(hrefs(false)).not.toContain(href);
      expect(hub.has(href)).toBe(true);
      expect(search.has(href)).toBe(true);
    }
    // The passport is a card on the hub page itself (my-health/page.tsx CARDS) and stays in search.
    expect(hrefs(false)).not.toContain("/patient/health-passport");
    expect(search.has("/patient/health-passport")).toBe(true);
  });

  it("search reaches the pages folded into the Health summary hub, now that the hub left the menu", () => {
    const search = new Set(buildPatientSearchIndex(menu(false)).map((e) => e.href));
    for (const href of ["/patient/health-report", "/patient/progress", "/patient/medicine-report", "/patient/health-score"]) {
      expect(search.has(href)).toBe(true);
    }
  });

  it("no page that left the menu depends on an entry a page gate can hide", () => {
    // The layout drops gated addresses (and Women's Health for a recorded male) from BOTH menu and search, so a page that survives
    // only in search must not be one of those, or some patients would lose it entirely.
    const now = new Set(hrefs(true));
    const gated = new Set(PATIENT_PAGE_GATES.flatMap((g) => [...g.webHrefs]));
    const leftMenu = OLD_PATIENT_MENU.filter((h) => !now.has(h));
    expect(leftMenu.sort()).toEqual(["/patient/health-passport", "/patient/health-records", "/patient/health-summary"]);
    for (const href of leftMenu) {
      expect(gated.has(href)).toBe(false);
      expect(href).not.toBe("/patient/womens-health");
    }
  });

  it("lists each address once", () => {
    const all = hrefs(true);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("patient menu shape (docs/design/PATIENT-DASHBOARD-2.md section 4)", () => {
  it("has the Home band then the five labelled groups, in order", () => {
    expect(menu(true).map((s) => s.label ?? "Home")).toEqual(["Home", "My health", "Healthcare", "My support", "Resources", "Account"]);
  });

  it("offers one My health record door, at the top of My health", () => {
    const myHealth = menu(false).find((s) => s.label === "My health");
    expect(myHealth?.items[0]).toMatchObject({ label: "My health record", href: "/patient/my-health" });
    const labels = menu(false).flatMap((s) => s.items.map((i) => i.label));
    for (const gone of ["Health summary", "My Health", "My Health Records", "Health Passport"]) expect(labels).not.toContain(gone);
  });

  it("keeps the Emergency card in the menu as the danger link", () => {
    const danger = menu(false).flatMap((s) => s.items).filter((i) => i.variant === "danger");
    expect(danger.map((i) => i.href)).toEqual(["/patient/emergency-card"]);
  });

  it("keeps Vitals and Medications inside My health", () => {
    const myHealth = menu(false).find((s) => s.label === "My health")?.items.map((i) => i.href) ?? [];
    expect(myHealth).toEqual(expect.arrayContaining(["/patient/vitals", "/patient/medications"]));
  });

  it("puts at most eight links in view per group; the rest sit behind More in this group", () => {
    for (const s of menu(true)) expect(s.items.filter((i) => !i.more && i.variant !== "danger").length).toBeLessThanOrEqual(8);
  });

  it("names the community Community (PD-02), in My support, only when it is open", () => {
    const support = menu(true).find((s) => s.label === "My support")?.items ?? [];
    expect(support.find((i) => i.href === "/patient/community")?.label).toBe("Community");
    expect(hrefs(false)).not.toContain("/patient/community");
  });
});

describe("phone bottom bar (PD-01)", () => {
  it("is Home, My Health, Messages, Care plan for a patient", () => {
    const tabs = primaryNavItems(menu(true));
    expect(tabs.map((i) => [i.shortLabel, i.href])).toEqual([
      ["Home", "/patient"],
      ["My Health", "/patient/my-health"],
      ["Messages", "/patient/messages"],
      ["Care plan", "/patient/care"],
    ]);
    expect(tabs.length).toBe(MAX_PRIMARY_NAV_ITEMS);
  });

  it("leaves the supporter-only tabs in declaration order", () => {
    expect(primaryNavItems(getNavSections("patient", false)).map((i) => i.href)).toEqual([
      "/patient/supporting",
      "/patient/messages",
      "/patient/family",
      "/patient/subscription",
    ]);
  });

  it("orders flagged links without primaryOrder by declaration, after ordered ones", () => {
    const sections = [
      { items: [{ label: "A", href: "/a", icon: "dashboard" as const, primary: true }] },
      { label: "G", items: [{ label: "B", href: "/b", icon: "dashboard" as const, primary: true, primaryOrder: 1 }, { label: "C", href: "/c", icon: "dashboard" as const, primary: true }] },
    ];
    expect(primaryNavItems(sections).map((i) => i.href)).toEqual(["/b", "/a", "/c"]);
  });
});
