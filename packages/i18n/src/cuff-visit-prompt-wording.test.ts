import { describe, expect, it } from "@jest/globals";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { t } from "./index";

/**
 * S07y: the sentence every patient could read about bringing their blood pressure monitor to a visit. The Chief Medical Officer's attestation
 * (`cuff_visit_prompt` / `visit_prompt_wording_signed`) is recorded against THIS exact text. The database cannot see the string, so it holds a fingerprint of it
 * (`private.cuff_visit_prompt_fingerprint()`) and opens the prompt only for an attestation whose note carries that fingerprint. This test ties the two together:
 * edit the sentence and CI fails until a migration ships the new fingerprint, which closes the prompt until the CMO attests the new text.
 */
const MIGRATIONS = new URL("../../../supabase/migrations/", import.meta.url);

/** Every migration that defines the fingerprint function, newest last; the newest wins (it replaces the earlier one). */
function shippedFingerprint(): string {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  let found: string | null = null;
  for (const f of files) {
    const sql = readFileSync(new URL(f, MIGRATIONS), "utf8");
    const m = /function private\.cuff_visit_prompt_fingerprint\(\)[\s\S]*?select '([0-9a-f]{12})'::text/.exec(sql);
    if (m?.[1]) found = m[1];
  }
  if (!found) throw new Error("no migration defines private.cuff_visit_prompt_fingerprint()");
  return found;
}

describe("cuff.visit_prompt wording", () => {
  const text = t("cuff.visit_prompt", "en");

  it("has the fingerprint the database holds (a change to the sentence needs a new fingerprint and a fresh attestation)", () => {
    expect(createHash("sha256").update(text).digest("hex").slice(0, 12)).toBe(shippedFingerprint());
  });

  it("is neutral: it says nothing about a reading, a result, a fault, a flag or a number, and is the same for every patient", () => {
    expect(text).not.toMatch(/\d/);
    expect(text).not.toMatch(/\b(reading|readings|result|results|wrong|inaccurate|accurate|fault|faulty|flag|flagged|high|low|differ|different|problem|concern|worry|check your|may read)\b/i);
    expect(text).not.toMatch(/[—–]/);
  });
});
