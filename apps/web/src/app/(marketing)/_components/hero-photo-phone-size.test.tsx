/** @jest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { PageHero } from "./page-hero";
import { HomeHeroFallback } from "./home-hero";

jest.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

afterEach(cleanup);

/**
 * The header photo is the largest thing on a phone screen for Home and For families, so it sets their LCP. Before
 * 2026-11-07 both asked for the full-screen-width file at the phone's native density (1080 to 1200px, 53 to 76KB) with
 * no fetch priority, and missed the 2.5s slow-4G target (2.8s and 3.0s live). A phone hint of at most 300px picks the
 * 750 or 828px file, and fetchpriority puts it ahead of scripts and fonts. These pin both so an edit cannot quietly undo it.
 *
 * phoneHintPx returns the width the browser takes from `sizes` on a 412px-wide phone: the first entry whose media condition matches, as a browser does.
 */
function phoneHintPx(sizes: string | null, viewport = 412): number {
  for (const entry of (sizes ?? "").split(",").map((e) => e.trim())) {
    const m = /^(?:\((min|max)-width: (\d+)px\) )?(\d+)(px|vw)$/.exec(entry);
    if (!m) throw new Error(`unparsed sizes entry: ${entry}`);
    const [, kind, bound, value, unit] = m;
    const matches = !kind || (kind === "min" ? viewport >= Number(bound) : viewport <= Number(bound));
    if (matches) return unit === "vw" ? (viewport * Number(value)) / 100 : Number(value);
  }
  return Number.POSITIVE_INFINITY;
}

describe("hero photos on a phone", () => {
  it("the shared page hero asks for a phone-sized file, with high fetch priority", () => {
    render(
      <PageHero eyebrow="E" title="T" description="D" image={{ src: "/marketing/photos/hero/gift.jpg", alt: "Family", width: 1400, height: 1750 }} />,
    );
    const img = screen.getByRole("img", { name: "Family" });
    expect(phoneHintPx(img.getAttribute("sizes"))).toBeLessThanOrEqual(300);
    expect(img.getAttribute("fetchpriority")).toBe("high");
  });

  it("the homepage hero photo asks for a phone-sized file, with high fetch priority", () => {
    render(<HomeHeroFallback />);
    const img = screen.getByRole("img", { name: /daughter and her mother/ });
    expect(phoneHintPx(img.getAttribute("sizes"))).toBeLessThanOrEqual(300);
    expect(img.getAttribute("fetchpriority")).toBe("high");
  });
});
