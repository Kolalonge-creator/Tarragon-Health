import { renderToStaticMarkup } from "react-dom/server";
import { t, type MessageKey } from "@tarragon/i18n";
import { TRUST_TIERS, TimelineTrustTier, isTrustTier, trustTierTone } from "./timeline-trust-tier";

describe("TimelineTrustTier", () => {
  it("says every tier in plain words, and every tier has wording", () => {
    for (const tier of TRUST_TIERS) {
      const html = renderToStaticMarkup(<TimelineTrustTier tier={tier} />);
      const words = t(`passport.tier.${tier}` as MessageKey);
      expect(words).not.toBe(`passport.tier.${tier}`);
      expect(html).toContain(words);
      expect(html).toContain(`data-trust-tier="${tier}"`);
    }
  });

  it("renders nothing for a tier it does not know, never a guess", () => {
    expect(renderToStaticMarkup(<TimelineTrustTier tier="doctor" />)).toBe("");
    expect(renderToStaticMarkup(<TimelineTrustTier tier={null} />)).toBe("");
    expect(renderToStaticMarkup(<TimelineTrustTier tier={undefined} />)).toBe("");
  });

  it("only an unconfirmed reading from a photo is flagged as needing attention", () => {
    expect(trustTierTone("ocr_unconfirmed")).toBe("attention");
    for (const tier of TRUST_TIERS.filter((x) => x !== "ocr_unconfirmed")) expect(trustTierTone(tier)).toBe("neutral");
    expect(renderToStaticMarkup(<TimelineTrustTier tier="ocr_unconfirmed" />)).toContain("amber");
  });

  it("never wording that claims a clinician stood behind an unconfirmed or patient-entered item", () => {
    for (const tier of ["patient", "ocr_unconfirmed", "ocr_confirmed", "device", "imported", "system"] as const) {
      expect(t(`passport.tier.${tier}` as MessageKey).toLowerCase()).not.toMatch(/care team|clinician|doctor/);
    }
  });

  it("isTrustTier narrows only the known tiers", () => {
    expect(isTrustTier("lab_pushed")).toBe(true);
    expect(isTrustTier("LAB_PUSHED")).toBe(false);
    expect(isTrustTier(3)).toBe(false);
  });
});
