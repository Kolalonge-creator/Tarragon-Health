import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLINICIAN_GOVERNANCE_SECTIONS, clinicianSearchSections, getNavSections, itemIsActive } from "./navigation";

const sidebar = getNavSections("clinician", null);
const sidebarItems = sidebar.flatMap((s) => s.items);
const governanceItems = CLINICIAN_GOVERNANCE_SECTIONS.flatMap((s) => s.items);

// The 140 doctor links as they stood before DW-02 (2026-11-06). None may disappear.
const BEFORE_DW02 = readFileSync(join(__dirname, "navigation-doctor-sidebar.before-dw02.txt"), "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

describe("doctor sidebar regroup (DW-02)", () => {
  it("uses the approved groups, in order", () => {
    expect(sidebar.map((s) => s.label ?? "(top)")).toEqual([
      "(top)",
      "Work",
      "Patients",
      "Reviews",
      "Medicines",
      "Orders and referrals",
      "Team",
      "You",
      "Governance",
    ]);
  });

  it("keeps every page that was linked before, in the sidebar or on the governance index", () => {
    const reachable = new Set([...sidebarItems, ...governanceItems].map((i) => i.href));
    expect(BEFORE_DW02.length).toBe(140);
    expect(BEFORE_DW02.filter((h) => !reachable.has(h))).toEqual([]);
  });

  it("lists each page once", () => {
    const all = [...sidebarItems, ...governanceItems].map((i) => i.href);
    expect(all.length).toBe(new Set(all).size);
  });

  it("keeps every live-count queue in the sidebar (the pending-jobs banner reads countKeys from it)", () => {
    expect(governanceItems.filter((i) => i.countKey)).toEqual([]);
  });

  it("links the governance index and the sign-off hub from the sidebar", () => {
    const hrefs = sidebarItems.map((i) => i.href);
    expect(hrefs).toContain("/clinician/governance");
    expect(hrefs).toContain("/clinician/clinical-signoff");
  });

  it("is much shorter than before", () => {
    expect(sidebarItems.length).toBeLessThan(100);
  });

  it("the CMO search still reaches every governance page", () => {
    const searchable = new Set(clinicianSearchSections().flatMap((s) => s.items.map((i) => i.href)));
    for (const item of governanceItems) expect(searchable.has(item.href)).toBe(true);
  });

  it("every /clinician link points at a real page", () => {
    const root = join(__dirname, "..", "app", "(dashboard)");
    for (const href of [...sidebarItems, ...governanceItems].map((i) => i.href)) {
      expect([href, readFileSync(join(root, href, "page.tsx"), "utf8").length > 0]).toEqual([href, true]);
    }
  });
});

describe("Governance home stays lit on the pages it leads to", () => {
  const governanceHome = sidebarItems.find((i) => i.href === "/clinician/governance");
  it("is active on the index and on every governance page", () => {
    expect(governanceHome).toBeDefined();
    if (!governanceHome) return;
    expect(itemIsActive("/clinician/governance", governanceHome)).toBe(true);
    expect(itemIsActive("/clinician/triage-rules", governanceHome)).toBe(true);
    expect(itemIsActive("/clinician/triage-protocols/compare", governanceHome)).toBe(true);
  });
  it("is not active on daily clinical pages", () => {
    if (!governanceHome) return;
    expect(itemIsActive("/clinician/escalations", governanceHome)).toBe(false);
    expect(itemIsActive("/clinician", governanceHome)).toBe(false);
  });
});

describe("Chief Medical Officer menu (CMO command centre, 2026-11-07)", () => {
  it("leads with the Leadership overview for the CMO and keeps their own clinical day one click away", () => {
    const top = getNavSections("clinician", null, { cmo: true })[0]?.items ?? [];
    expect(top.map((i) => [i.label, i.href])).toEqual([
      ["Leadership overview", "/clinician/leadership"],
      ["My clinical day", "/clinician"],
    ]);
  });

  it("changes nothing for any other doctor", () => {
    expect(sidebarItems.some((i) => i.href === "/clinician/leadership")).toBe(false);
    expect(sidebar[0]?.items.map((i) => i.label)).toEqual(["Today"]);
  });

  it("puts the overview in the CMO's search index", () => {
    expect(clinicianSearchSections().flatMap((s) => s.items).some((i) => i.href === "/clinician/leadership")).toBe(true);
  });
});
