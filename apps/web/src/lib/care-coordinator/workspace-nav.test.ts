/**
 * The coordination workspace's menu must not offer a link the proxy bounces, for either kind of person who uses it: a Care
 * Coordinator (whose /clinician/* access is a fixed allow-list in proxy.ts) and a doctor covering coordination (who must be let into
 * /dashboard/care-coordinator/*, which is another role's home). Same reasoning and same source-reading approach as
 * lib/navigation-coordinator-reachability.test.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { activeLink, linkIsActive, workspaceSections } from "./workspace-nav";

const proxySrc = readFileSync(join(__dirname, "..", "..", "proxy.ts"), "utf8");

function coordinatorAllowList(): string[] {
  const start = proxySrc.indexOf("const isCoordinatorClinicianPath");
  expect(start).toBeGreaterThan(-1);
  const block = proxySrc.slice(start, proxySrc.indexOf("].some(", start));
  const paths = [...block.matchAll(/"(\/clinician\/[a-z-]+)"/g)].map((m) => m[1]);
  expect(paths.length).toBeGreaterThan(0);
  return paths;
}

const links = workspaceSections({ showCommunity: true }).flatMap((s) => s.links);

describe("coordination workspace menu", () => {
  it("offers a coordinator no /clinician link the proxy would bounce", () => {
    const allowed = coordinatorAllowList();
    const unreachable = links
      .map((l) => l.href)
      .filter((h) => h.startsWith("/clinician/"))
      .filter((h) => !allowed.some((a) => h === a || h.startsWith(`${a}/`)));
    expect(unreachable).toEqual([]);
  });

  it("lets a doctor into the workspace pages (CC-1)", () => {
    const start = proxySrc.indexOf("const isClinicianCoordinationPath");
    expect(start).toBeGreaterThan(-1);
    const block = proxySrc.slice(start, proxySrc.indexOf("if (isClinicianCoordinationPath)", start));
    expect(block).toContain('profile.role === "clinician"');
    expect(block).toContain('pathname.startsWith("/dashboard/care-coordinator/")');
    // the community redirect for doctors must run before the doctor door opens
    expect(proxySrc.indexOf('"/dashboard/care-coordinator/community"')).toBeLessThan(start);
  });

  it("has unique links and hides Community unless asked", () => {
    const hrefs = links.map((l) => l.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(workspaceSections({ showCommunity: false }).flatMap((s) => s.links).some((l) => l.icon === "community")).toBe(false);
  });

  it("marks the command centre active only on its own path, and falls back to it for an unknown page", () => {
    const sections = workspaceSections({ showCommunity: false });
    const home = sections[0].links[0];
    expect(linkIsActive("/dashboard/care-coordinator", home)).toBe(true);
    expect(linkIsActive("/dashboard/care-coordinator/outreach", home)).toBe(false);
    expect(activeLink("/dashboard/care-coordinator/outreach", sections).link.label).toBe("Outreach");
    expect(activeLink("/dashboard/care-coordinator/nowhere", sections).link.label).toBe("Command centre");
  });
});
