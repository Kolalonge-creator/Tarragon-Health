/**
 * S59c drift guard: the bundled drafts (drafts.ts) and the seed in the migration are the same config. A signed copy is pasted back into
 * drafts.ts in the same commit as the registry entry; this test (and the shared package's mirror test) fail if any copy differs.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "@jest/globals";
import { CHECKBACK_DRAFT, DESCRIBE_DRAFT, EXPLAINER_DRAFT, SAFETY_NET_DRAFT } from "./drafts";
import { checkbackConfigSchema } from "./checkback";
import { describeTableSchema } from "./describe-match";
import { explainerConfigSchema } from "./explainer";
import { safetyNetConfigSchema } from "./safety-net";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seedOf(kind: string): unknown {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s59c_assessment_ux.sql"));
  if (!file) throw new Error("S59c migration not found");
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const m = new RegExp(`-- ux-seed-${kind}-begin[\\s\\S]*?\\$json\\$([\\s\\S]*?)\\$json\\$[\\s\\S]*?-- ux-seed-${kind}-end`).exec(sql);
  if (!m?.[1]) throw new Error(`seed for ${kind} not found`);
  return JSON.parse(m[1]);
}

describe("bundled drafts equal the migration seeds", () => {
  const cases = [
    ["checkback", CHECKBACK_DRAFT, checkbackConfigSchema],
    ["describe", DESCRIBE_DRAFT, describeTableSchema],
    ["explainer", EXPLAINER_DRAFT, explainerConfigSchema],
    ["safety_net", SAFETY_NET_DRAFT, safetyNetConfigSchema],
  ] as const;
  for (const [kind, draft, schema] of cases) {
    it(`${kind}: identical, parses, and is an unsigned draft`, () => {
      const seed = seedOf(kind);
      expect(seed).toEqual(draft);
      expect(schema.safeParse(seed).success).toBe(true);
      expect((seed as { status: string }).status).toBe("draft");
      expect((seed as { clinical_sign_off: unknown }).clinical_sign_off).toBeNull();
    });
  }
});
