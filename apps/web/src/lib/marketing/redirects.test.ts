import { existsSync } from "node:fs";
import { join } from "node:path";
import { MARKETING_REDIRECTS } from "./redirects";

const MARKETING = join(__dirname, "..", "..", "app", "(marketing)");

describe("marketing redirects", () => {
  it.each(MARKETING_REDIRECTS.map((r) => [r.source, r.destination]))("%s goes to a live page (%s)", (source, destination) => {
    const path = destination.split("#")[0]!.replace(/^\//, "");
    expect(existsSync(join(MARKETING, path, "page.tsx"))).toBe(true);
    // The old page must be gone, or the redirect would shadow a real page.
    expect(existsSync(join(MARKETING, source.replace(/^\//, ""), "page.tsx"))).toBe(false);
  });
});

describe("retired route keys", () => {
  it("every retired key has a redirect and is not in the sitemap list", async () => {
    const { MARKETING_ROUTES, MARKETING_ROUTES_BUILT, RETIRED_ROUTE_KEYS } = await import("./routes");
    for (const key of RETIRED_ROUTE_KEYS) {
      expect(MARKETING_REDIRECTS.some((r) => r.source === MARKETING_ROUTES[key])).toBe(true);
      expect(MARKETING_ROUTES_BUILT).not.toContain(key);
    }
  });
});
