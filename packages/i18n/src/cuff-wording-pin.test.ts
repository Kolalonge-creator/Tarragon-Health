import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "@jest/globals";
import { en } from "./index";

/**
 * S07y: the patient wording of the cuff guide and the cuff size step is pinned to the signed row. The Chief Medical Officer signs
 * `bp_cuff_guidance_signoffs`, whose config carries a hash of every `hc.cuff.*` string. If a word here changes, this test fails until a NEW
 * version of that row (with the new hash) exists to be signed, so a signature can never quietly cover wording nobody read.
 */
const DIR = new URL("../../../supabase/migrations/", import.meta.url);
const MIGRATION = readFileSync(new URL(readdirSync(DIR).find((f) => f.endsWith("_s07y_cuff_guidance_and_bp_band_report.sql"))!, DIR), "utf8");
const SEED = JSON.parse(/cuff-config-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(MIGRATION)![1]!) as { wordingSha256: string };

export function cuffWordingHash(catalogue: Record<string, string>): string {
  const keys = Object.keys(catalogue)
    .filter((k) => k.startsWith("hc.cuff."))
    .sort();
  return createHash("sha256")
    .update(keys.map((k) => `${k}=${catalogue[k]}\n`).join(""))
    .digest("hex");
}

describe("cuff wording is pinned to the signed configuration (S07y)", () => {
  it("matches the hash in the version 1 seed", () => {
    expect(cuffWordingHash(en as Record<string, string>)).toBe(SEED.wordingSha256);
  });
  it("covers the whole guide and the size step", () => {
    const keys = Object.keys(en).filter((k) => k.startsWith("hc.cuff."));
    expect(keys.length).toBeGreaterThanOrEqual(30);
    expect(keys).toEqual(expect.arrayContaining(["hc.cuff.device", "hc.cuff.size_intro", "hc.cuff.list.not_listed"]));
  });
});
