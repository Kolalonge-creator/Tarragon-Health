/**
 * A Care Coordinator's sidebar must not offer a /clinician/* link the proxy
 * will bounce.
 *
 * On 2026-09-05 four of the twelve links in that sidebar (Case management,
 * Safeguarding, Operations queue, Medication issues) pointed at paths absent
 * from proxy.ts's `isCoordinatorClinicianPath` allow-list, so a third of the
 * menu redirected to /dashboard/care-coordinator with no explanation. Two were
 * genuinely out of scope for the role and were removed; two were legitimate
 * coordinator work and the allow-list was extended instead.
 *
 * Nothing structural stopped that drifting again: the nav and the allow-list
 * are two hand-maintained lists in different files with no link between them.
 * This test is that link. It reads the allow-list out of the proxy source
 * rather than importing it, because it is a local inside the request handler
 * and is not exported; the regex is anchored on the identifier so a rename
 * fails the test loudly rather than silently matching nothing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getNavSections } from "./navigation";

function coordinatorAllowList(): string[] {
  const src = readFileSync(join(__dirname, "..", "proxy.ts"), "utf8");
  const start = src.indexOf("const isCoordinatorClinicianPath");
  expect(start).toBeGreaterThan(-1);
  const block = src.slice(start, src.indexOf("].some(", start));
  const paths = [...block.matchAll(/"(\/clinician\/[a-z-]+)"/g)].map((m) => m[1]);
  // Guard against the regex silently matching nothing after a refactor.
  expect(paths.length).toBeGreaterThan(0);
  return paths;
}

function coordinatorClinicianLinks(): string[] {
  // Second argument is the receives-care flag; irrelevant for a coordinator,
  // whose menu does not branch on it, but the signature requires it.
  const sections = getNavSections("care_coordinator", true);
  const hrefs: string[] = [];
  const walk = (items: readonly { href?: string; items?: readonly unknown[] }[]) => {
    for (const item of items) {
      if (typeof item.href === "string") hrefs.push(item.href);
      if (Array.isArray(item.items)) walk(item.items as never);
    }
  };
  walk(sections as never);
  return hrefs.filter((h) => h.startsWith("/clinician/"));
}

describe("Care Coordinator navigation reachability", () => {
  it("offers no /clinician link the proxy allow-list would bounce", () => {
    const allowed = coordinatorAllowList();
    const offered = coordinatorClinicianLinks();

    const unreachable = offered.filter(
      (href) => !allowed.some((a) => href === a || href.startsWith(`${a}/`))
    );

    expect(unreachable).toEqual([]);
  });

  it("still offers something, so the test cannot pass by the nav being empty", () => {
    expect(coordinatorClinicianLinks().length).toBeGreaterThan(0);
  });

  it("keeps the allow-list a fixed list rather than a /clinician/* wildcard", () => {
    // A Coordinator must never reach clinical-judgment-only surfaces just
    // because they share the prefix, so the allow-list must stay explicit.
    const allowed = coordinatorAllowList();
    expect(allowed).not.toContain("/clinician");
    expect(allowed.length).toBeLessThan(12);
  });
});
