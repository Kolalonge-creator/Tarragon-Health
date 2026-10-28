import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "@jest/globals";
import { en } from "./index";

/**
 * W-35: the v2 cuff wording is a PROPOSAL document for the CMO, not shipped text. This keeps the document honest: it must quote the
 * live signed text and the signed hash exactly, so it cannot drift from what the app actually ships (see cuff-wording-pin.test.ts).
 */
const DOC = readFileSync(new URL("../../../docs/design/cuff-wording-v2-proposal.md", import.meta.url), "utf8");
const DIR = new URL("../../../supabase/migrations/", import.meta.url);
const MIGRATION = readFileSync(new URL(readdirSync(DIR).find((f) => f.endsWith("_s07y_cuff_guidance_and_bp_band_report.sql"))!, DIR), "utf8");
const SEED = JSON.parse(/cuff-config-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(MIGRATION)![1]!) as { wordingSha256: string };

describe("cuff wording v2 proposal document", () => {
  it("quotes the signed hash and the shipped signed text exactly", () => {
    expect(DOC).toContain(SEED.wordingSha256);
    expect(DOC).toContain((en as Record<string, string>)["hc.cuff.device"]);
    expect(DOC).toContain((en as Record<string, string>)["hc.cuff.pregnancy"]);
  });
  it("is clear that it is a proposal and that no migration is applied", () => {
    expect(DOC).toMatch(/PROPOSAL ONLY/);
    expect(DOC).toMatch(/NOT applied/);
  });
});
