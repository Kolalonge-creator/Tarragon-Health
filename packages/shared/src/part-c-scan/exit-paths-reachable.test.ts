import { describe, expect, it } from "@jest/globals";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * S87 reachability: a person can always get out. Account deletion, a refund request and the "nothing to cancel"
 * statement must each be reachable from the app's own navigation, not just exist as a file. This reads source, so it is
 * fast; the journey itself is covered by the screen tests next to each component.
 */
const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const web = (p: string) => join(repoRoot, "apps/web/src", p);
const read = (p: string) => readFileSync(web(p), "utf8");

describe("exit paths are reachable (S87)", () => {
  it("account deletion: nav link, page, panel and card are wired end to end", () => {
    expect(read("lib/navigation.ts")).toContain('href: "/patient/privacy"');
    expect(existsSync(web("app/(dashboard)/patient/privacy/page.tsx"))).toBe(true);
    expect(read("app/(dashboard)/patient/privacy/page.tsx")).toMatch(/<DataRightsPanel\b/);
    expect(read("app/(dashboard)/patient/privacy/data-rights-panel.tsx")).toMatch(/<DeletionRequestCard\b/);
    // the request is reviewed by admin, so the other end must exist too
    expect(read("lib/navigation.ts")).toContain('href: "/admin/data-rights"');
    expect(existsSync(web("app/(dashboard)/admin/data-rights/data-rights-review-dashboard.tsx"))).toBe(true);
  });

  it("refund request: reachable from Your finances, and the rule is stated beside every purchase", () => {
    expect(read("lib/navigation.ts")).toContain('href: "/patient/financial-profile"');
    expect(read("app/(dashboard)/patient/financial-profile/page.tsx")).toMatch(/<RequestRefundButton\b/);
    expect(read("app/(dashboard)/patient/membership/membership-shop.tsx")).toMatch(/<RefundRule\b/);
    expect(read("lib/navigation.ts")).toContain('href: "/patient/membership"');
  });

  it("cancellation: public pages say what a person can do and when", () => {
    const pricing = read("app/(marketing)/pricing/page.tsx");
    const terms = read("app/(marketing)/terms/page.tsx");
    expect(pricing).toMatch(/Can I get a refund\?/);
    expect(terms).toMatch(/refund/i);
    // the app's own services page says there is nothing to cancel for a fixed-term pack
    expect(read("app/(dashboard)/patient/subscription/subscription-manager.tsx")).toMatch(/nothing to cancel/i);
  });

  it("sabotage: the checks above would fail if the card were unmounted", () => {
    const without = read("app/(dashboard)/patient/privacy/data-rights-panel.tsx").replace(/<DeletionRequestCard\b/g, "<Gone");
    expect(without).not.toMatch(/<DeletionRequestCard\b/);
  });
});
