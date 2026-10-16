import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * S47: reproductive health, mental health and device data are optional PER USE. They are asked when a person first uses the feature (feature_consent_state /
 * grantFeatureConsentAction) and are never a step of account creation. A scan, so a future onboarding change that quietly adds one fails here.
 */
const DIR = __dirname;
const SENSITIVE_CONSENT = /(reproductive|mental_health|device_data|wearable_device_data)/;

describe("onboarding does not ask for the optional-per-use consents", () => {
  const files = readdirSync(DIR).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f));

  it("has onboarding sources to scan", () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it("no onboarding source mentions those consent data types", () => {
    const offenders = files.filter((f) => SENSITIVE_CONSENT.test(readFileSync(join(DIR, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the scan can fail: it would catch a mention", () => {
    expect(SENSITIVE_CONSENT.test('consent_type: "reproductive"')).toBe(true);
  });
});
