import { readFileSync } from "node:fs";
import { join } from "node:path";

/** W-55: the counsel-facing legal docs must not describe things the platform has removed. */
const LEGAL = join(__dirname, "..", "..", "..", "..", "..", "docs", "legal");
const read = (f: string) => readFileSync(join(LEGAL, f), "utf8");

describe("legal docs describe the platform as it is", () => {
  for (const file of ["cover-memo-to-counsel.md", "breach-notification-runbook.md"]) {
    it(`${file} does not describe a live wallet, subscription, Stripe or WhatsApp channel`, () => {
      const text = read(file);
      expect(text).not.toMatch(/WhatsApp is notification-only/i);
      expect(text).not.toMatch(/we also operate a \*\*Health Wallet/i);
      expect(text).not.toMatch(/Patients pay by subscription/i);
      expect(text).not.toMatch(/Paystack's\/Stripe's/i);
      expect(text).not.toMatch(/\bTier [1-5]\b/);
    });
  }

  it("the cover memo records NDPC registration approved and the DPO appointment accepted", () => {
    const text = read("cover-memo-to-counsel.md");
    expect(text).toMatch(/NDPC registration is approved/);
    expect(text).toMatch(/15 September 2026/);
  });

  it("the runbook marks the DPO name as a founder input rather than inventing one", () => {
    expect(read("breach-notification-runbook.md")).toMatch(/FOUNDER INPUT NEEDED/);
  });
});
