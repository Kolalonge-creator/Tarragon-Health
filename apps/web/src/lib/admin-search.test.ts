import { describe, expect, it } from "@jest/globals";
import { buildAdminSearchIndex, searchAdminEntries, type AdminSearchEntry } from "./admin-search";
import type { NavSection } from "./navigation";

const sections: NavSection[] = [
  {
    items: [
      { label: "Dashboard", href: "/admin", icon: "dashboard", exact: true },
      { label: "Operations console", href: "/admin/ops", icon: "operations" },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Patients", href: "/admin/patients", icon: "members" },
      { label: "Clinician credentialing", href: "/admin/credentialing", icon: "review" },
      { label: "Incident register", href: "/admin/ops/incidents", icon: "siren" },
    ],
  },
];

const settings = [
  { href: "/admin/settings/clinical-staff", label: "Clinical staff", blurb: "Add and verify every MDCN-credentialed doctor.", group: "People & Access" },
  { href: "/admin/settings/members", label: "Members & access", blurb: "Create logins and assign roles.", group: "People & Access" },
  { href: "/admin/patients", label: "Patients again", blurb: "duplicate of a sidebar page", group: "Organisation" },
];

const index = buildAdminSearchIndex(sections, settings);
const labels = (q: string, limit?: number) => searchAdminEntries(index, q, limit).map((e) => e.label);

describe("buildAdminSearchIndex", () => {
  it("includes the sidebar, the settings pages and the credentialing sub-page, once per path", () => {
    const hrefs = index.map((e) => e.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).toEqual(expect.arrayContaining(["/admin", "/admin/credentialing", "/admin/credentialing/expiry", "/admin/settings/members"]));
  });

  it("lets the sidebar win over a settings page with the same path", () => {
    expect(index.find((e) => e.href === "/admin/patients")?.label).toBe("Patients");
  });

  it("names where each page lives", () => {
    expect(index.find((e) => e.href === "/admin")?.group).toBe("Main");
    expect(index.find((e) => e.href === "/admin/settings/members")?.group).toBe("Settings, People & Access");
  });
});

describe("searchAdminEntries", () => {
  it("finds the credentialing pages by the words a person would use", () => {
    expect(labels("credentialing")[0]).toBe("Clinician credentialing");
    expect(labels("licence")).toContain("Licences and cover");
    expect(labels("mdcn")).toEqual(expect.arrayContaining(["Clinical staff", "Clinician credentialing"]));
    expect(labels("applicant")).toContain("Clinician credentialing");
  });

  it("ranks a title that starts with the word above one that merely mentions it", () => {
    expect(labels("patients")[0]).toBe("Patients");
    expect(labels("doctor")[0]).not.toBe("Patients");
  });

  it("needs every word to match, in any order", () => {
    expect(labels("staff clinical")).toEqual(["Clinical staff"]);
    expect(labels("clinical zebra")).toEqual([]);
  });

  it("ignores case and accents and matches inside words", () => {
    expect(labels("ÓPERATIONS")).toContain("Operations console");
    expect(labels("regist")).toContain("Incident register");
  });

  it("tolerates a skipped letter on longer words only", () => {
    expect(labels("pn")).toEqual([]);
    expect(labels("pnts")).toContain("Patients");
    expect(labels("dshbrd")).toContain("Dashboard");
  });

  it("returns the first entries for an empty query and respects the limit", () => {
    expect(labels("", 2)).toEqual(["Dashboard", "Operations console"]);
    expect(labels("   ", 3).length).toBe(3);
  });

  it("keeps the order of the menus when scores tie", () => {
    const tie: AdminSearchEntry[] = [
      { label: "Alpha page", href: "/a", group: "G" },
      { label: "Beta page", href: "/b", group: "G" },
    ];
    expect(searchAdminEntries(tie, "page").map((e) => e.href)).toEqual(["/a", "/b"]);
  });
});
