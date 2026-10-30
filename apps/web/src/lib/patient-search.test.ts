import { readdirSync, statSync } from "fs";
import { join } from "path";
import { buildPatientSearchIndex, PATIENT_EXTRA_PAGES } from "./patient-search";
import { searchAdminEntries } from "./admin-search";
import { getNavSections } from "./navigation";

const index = () => buildPatientSearchIndex(getNavSections("patient", true));
const top = (q: string) => searchAdminEntries(index(), q, 3).map((e) => e.href);

describe("patient search", () => {
  it("finds a page by the word a person would type", () => {
    expect(top("tablets")[0]).toBe("/patient/medications");
    expect(top("sugar")).toContain("/patient/vitals");
    expect(top("results")).toContain("/patient/labs");
    expect(top("period")[0]).toBe("/patient/womens-health");
  });
  it("never lists a staff or admin page", () => {
    expect(index().every((e) => e.href.startsWith("/patient"))).toBe(true);
  });
  it("only lists pages that exist (no dead ends)", () => {
    const pages = new Set<string>();
    const walk = (dir: string, rel: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, name.startsWith("(") ? rel : `${rel}/${name}`);
        else if (name === "page.tsx") pages.add(rel || "/");
      }
    };
    walk(join(__dirname, "../app/(dashboard)/patient"), "/patient");
    for (const e of PATIENT_EXTRA_PAGES) expect(pages.has(e.href)).toBe(true);
  });
});
