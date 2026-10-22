import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "@jest/globals";
import { en } from "./index";

/**
 * S56b: the patient wording of the calm tool (`panic.*`) and of the patterns view (`insights.*`) is pinned to the CMO's attestation.
 * The database cannot see these strings, so it holds a fingerprint of each set (`private.s56b_panic_fingerprint()` and
 * `private.s56b_insights_fingerprint()`) and treats the wording as attested only while the latest attestation's note carries it. Change a word
 * and this test fails until a migration ships the new fingerprint, which closes the feature until the CMO attests the new text.
 */
const MIGRATIONS = new URL("../../../supabase/migrations/", import.meta.url);

function shipped(fn: string): string {
  let found: string | null = null;
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = readFileSync(new URL(f, MIGRATIONS), "utf8");
    const m = new RegExp(`function private\\.${fn}\\(\\)[\\s\\S]*?select '([0-9a-f]{12})'::text`).exec(sql);
    if (m?.[1]) found = m[1];
  }
  if (!found) throw new Error(`no migration defines private.${fn}()`);
  return found;
}

/** First 12 hex characters of the SHA-256 of "key=value\n" for every key with the prefix, sorted by key. The CMO panel computes the same value. */
export function wordingFingerprint(catalogue: Record<string, string>, prefix: string): string {
  const keys = Object.keys(catalogue).filter((k) => k.startsWith(prefix)).sort();
  return createHash("sha256").update(keys.map((k) => `${k}=${catalogue[k]}\n`).join("")).digest("hex").slice(0, 12);
}

const cat = en as Record<string, string>;
const keysOf = (prefix: string) => Object.keys(cat).filter((k) => k.startsWith(prefix));

describe("calm tool wording (panic.*)", () => {
  it("has the fingerprint the database holds (a change needs a new fingerprint and a fresh attestation)", () => {
    expect(wordingFingerprint(cat, "panic.")).toBe(shipped("s56b_panic_fingerprint"));
  });
  it("is calm and plain: no helpline numbers, no treatment claims, no urgency words, no em dashes", () => {
    const all = keysOf("panic.").map((k) => cat[k]).join("\n");
    expect(keysOf("panic.").length).toBeGreaterThanOrEqual(30);
    expect(all).not.toMatch(/\d{3,}/); // no phone numbers
    expect(all).not.toMatch(/\b(treat|treatment|cure|cures|therapy|therapist|diagnos\w*|medicine|medication|clinically|proven|guarantee\w*|WARNING|urgent|emergency)\b/i);
    expect(all).not.toMatch(/[—–]/);
  });
  it("offers the way out to help in words that name the danger, without a number", () => {
    expect(cat["panic.danger"]).toBe("I am in danger or thinking of harming myself");
  });
  it("tells the person nothing is saved unless they choose to tell their care team", () => {
    expect(cat["panic.not_saved"]).toMatch(/not saved|is saved unless/i);
  });
});

describe("patterns wording (insights.*)", () => {
  it("has the fingerprint the database holds", () => {
    expect(wordingFingerprint(cat, "insights.")).toBe(shipped("s56b_insights_fingerprint"));
  });
  // The sentences must describe what happened on the same days. None may say or imply that one thing caused another.
  const CAUSAL = /\b(because|cause|causes|caused|causing|due to|owing to|leads? to|led to|result of|results? in|resulted|makes? you|made you|making you|triggers?|triggered|reason|therefore|explains?|explained|so that|thanks to|brings? on|brought on|affects?|affected|impact\w*|influenc\w*|contribut\w*)\b/i;
  it("no insights.* sentence uses a causal word", () => {
    for (const k of keysOf("insights.")) expect([k, CAUSAL.test(cat[k] as string)]).toEqual([k, false]);
  });
  it("the template set is exactly four and each shows the numbers behind it", () => {
    const tpl = keysOf("insights.tpl.");
    expect(tpl.sort()).toEqual(["insights.tpl.bp", "insights.tpl.sleep", "insights.tpl.tag", "insights.tpl.weekday"]);
    for (const k of tpl) {
      const text = cat[k] as string;
      for (const p of ["{totalA}", "{lowA}", "{totalB}", "{lowB}"]) expect([k, text.includes(p)]).toEqual([k, true]);
      expect([k, /\bon the\b|\bon \{weekday\}s/i.test(text)]).toEqual([k, true]); // a statement about days, not about the person
    }
  });
  it("says it is private and not advice, and has no em dashes", () => {
    expect(cat["insights.private"]).toMatch(/Only you can see this/);
    expect(cat["insights.private"]).toMatch(/never changes any score/);
    expect(cat["insights.not_advice"]).toMatch(/not a diagnosis/);
    expect(keysOf("insights.").map((k) => cat[k]).join("\n")).not.toMatch(/[—–]/);
  });
  it("the screen title does not use the word trigger", () => {
    expect(cat["insights.title"]).not.toMatch(/trigger/i);
  });
});

describe("share summary wording (wsum.*)", () => {
  it("says the journal is never included and nothing is chosen for you", () => {
    expect(cat["wsum.intro"]).toMatch(/private journal is never included/);
    expect(cat["wsum.intro"]).toMatch(/Nothing is chosen for you/);
  });
  it("labels scores as the patient's own numbers, not a diagnosis, and has no em dashes", () => {
    expect(cat["wsum.scores_note"]).toMatch(/not a diagnosis/);
    expect(keysOf("wsum.").map((k) => cat[k]).join("\n")).not.toMatch(/[—–]/);
  });
});
