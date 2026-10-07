import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { getNavSections } from "./../navigation";
import { ADMIN_EXTRA_PAGES, buildAdminSearchIndex, CMO_EXTRA_PAGES } from "../admin-search";

/**
 * S36i safety scans (spec INV-07, S20 safety rules 1 and 4). These read the source, so a later edit that adds a console line,
 * a service-role client, a concern in an address, an admin door or a cached page fails here rather than in production.
 */
const root = join(__dirname, "..", "..");
const lib = join(root, "lib", "concerns");
const pages = [
  join(root, "app", "(dashboard)", "clinician", "quality", "concerns", "page.tsx"),
  join(root, "app", "(dashboard)", "clinician", "my-concerns", "page.tsx"),
];
const sources = [...readdirSync(lib).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts")).map((f) => join(lib, f)), ...pages];
const text = (f: string) => readFileSync(f, "utf8");

describe("the concern screens", () => {
  it("log nothing, use no service role and call no language model", () => {
    for (const f of sources) {
      const s = text(f);
      expect(s).not.toMatch(/console\./);
      expect(s).not.toMatch(/service[_-]?role|createAdminClient|createServiceClient|SUPABASE_SERVICE/i);
      expect(s).not.toMatch(/anthropic|openai|runGovernedAi/i);
    }
  });
  it("never put an id or a concern's words in an address or a link", () => {
    for (const f of pages) {
      const s = text(f);
      expect(s).not.toMatch(/href=\{`[^`]*\$\{[a-z]+\.id\}/);
      expect(s).not.toMatch(/router\.(push|replace)/);
    }
    for (const f of sources.filter((x) => x.endsWith("actions.ts"))) {
      // every redirect is a fixed path plus the notice token and nothing else
      const redirects = text(f).match(/redirect\(`[^`]*`\)/g) ?? [];
      for (const r of redirects) expect(r).toMatch(/^redirect\(`\$\{path\}\?n=\$\{n\}`\)$|^redirect\(`\$\{LEAD\}\?n=\$\{n\}`\)$/);
    }
  });
  it("are dynamic, never cached and not indexed", () => {
    for (const f of pages) {
      const s = text(f);
      expect(s).toMatch(/export const dynamic = "force-dynamic"/);
      expect(s).toMatch(/export const revalidate = 0/);
      expect(s).toMatch(/robots: \{ index: false/);
    }
    expect(readFileSync(join(root, "..", "next.config.ts"), "utf8")).toMatch(/quality\/concerns\|my-concerns[\s\S]{0,200}no-store/);
  });
  it("show no error text from the database", () => {
    for (const f of sources.filter((x) => x.endsWith("actions.ts") || x.endsWith("load.ts"))) expect(text(f)).not.toMatch(/error\.message|\.message\b/);
  });
});

describe("no admin door and no admin search entry", () => {
  const concernPaths = ["/clinician/quality/concerns", "/clinician/my-concerns"];
  it("the admin and operations menus and search never list the concern pages", () => {
    for (const role of ["admin", "superadmin", "ops", "finance", "patient"]) {
      const hrefs = getNavSections(role, null).flatMap((s) => s.items.map((i) => i.href));
      for (const p of concernPaths) expect(hrefs).not.toContain(p);
    }
    const adminIndex = buildAdminSearchIndex(getNavSections("admin", null), [], ADMIN_EXTRA_PAGES);
    for (const e of adminIndex) expect(concernPaths).not.toContain(e.href);
  });
  it("the one search entry is the CMO's list and carries no concern text", () => {
    const entry = CMO_EXTRA_PAGES.find((e) => e.href === "/clinician/quality/concerns");
    expect(entry).toBeDefined();
    expect(`${entry?.label} ${entry?.hint}`).not.toMatch(/\d/);
  });
});
