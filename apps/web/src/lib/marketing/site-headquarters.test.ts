import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SITE } from "./site";

/**
 * The headquarters is published in two shapes that have to agree: the parts
 * (`addressLocality`/`addressRegion`/`addressCountry`) that feed the
 * Organization structured data, and the one-line `headquarters` string the
 * footer and contact page render. Nothing in the type system ties them
 * together, so a later edit to one is free to drift from the other, and the
 * failure is invisible in the running app: the page would still read fine
 * while a search engine resolved the brand to a different place.
 *
 * Also guards the standing rule that Tarragon publishes no street address
 * (no owned clinics, nowhere for a patient to turn up), so the HQ never
 * quietly grows into a walk-in address.
 */

const MARKETING_LAYOUT = join(
  __dirname,
  "..",
  "..",
  "app",
  "(marketing)",
  "layout.tsx",
);

describe("SITE headquarters", () => {
  it("has the display string agree with the structured-data parts", () => {
    expect(SITE.headquarters).toContain(SITE.addressLocality);
    expect(SITE.headquarters).toContain(SITE.addressRegion);
    // addressCountry is the ISO code; the display string spells it out.
    expect(SITE.addressCountry).toBe("NG");
    expect(SITE.headquarters).toContain("Nigeria");
    // The contact page renders "Headquarters: {headquarters}. We are an
    // online service…", so a trailing period here would double up.
    expect(SITE.headquarters.endsWith(".")).toBe(false);
  });

  it("publishes no street address or postcode", () => {
    // A street number, a "Street/Road/Avenue/Close/Plot/Suite" token, or a
    // postcode would mean someone turned the registered HQ into somewhere a
    // patient could be told to attend. See the comment on SITE.
    expect(SITE.headquarters).not.toMatch(
      /\b(street|road|avenue|close|crescent|plot|suite|floor|p\.?o\.? box)\b/i,
    );
    expect(SITE.headquarters).not.toMatch(/\d/);
  });

  it("feeds the Organization PostalAddress in the marketing layout", () => {
    // Source-text guard: layout.tsx is a server component and does not load
    // under this Jest config, but the thing worth protecting is that the
    // JSON-LD reads the same constants rather than a hardcoded duplicate.
    const source = readFileSync(MARKETING_LAYOUT, "utf8");
    expect(source).toContain("addressLocality: SITE.addressLocality");
    expect(source).toContain("addressRegion: SITE.addressRegion");
    expect(source).toContain("addressCountry: SITE.addressCountry");
  });
});
