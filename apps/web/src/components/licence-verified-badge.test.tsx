import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { LicenceVerifiedBadge } from "./licence-verified-badge";

describe("LicenceVerifiedBadge (null-gated like ReviewedByDoctor)", () => {
  it("no record => no badge", () => {
    for (const v of [null, undefined, "", "not a date", "2026-13-45", "2026-10-05T10:00:00Z"]) {
      expect(renderToStaticMarkup(<LicenceVerifiedBadge verifiedOn={v} />)).toBe("");
    }
  });
  it("a stored verification date shows the date and nothing else", () => {
    const html = renderToStaticMarkup(<LicenceVerifiedBadge verifiedOn="2026-10-05" />);
    expect(html).toContain("Licence verified on 5 Oct 2026");
    expect(html).not.toMatch(/MDCN\/|folio|\d{5,}/i);
  });
  it("takes no folio or free-text prop at all (the type forbids it)", () => {
    // @ts-expect-error the badge accepts a date and a class name only
    renderToStaticMarkup(<LicenceVerifiedBadge verifiedOn="2026-10-05" folio="MDCN/R/123456" />);
  });
});
