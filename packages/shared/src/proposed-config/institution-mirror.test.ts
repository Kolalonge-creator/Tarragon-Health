import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seededRules(): Record<string, unknown> {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s79_institution_console.sql"));
  if (!file) throw new Error("S79 migration not found");
  const match = /institution-rules-v1-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  if (!match?.[1]) throw new Error("institution rules seed not found");
  return JSON.parse(match[1]) as Record<string, unknown>;
}

describe("institution.rules mirrors the migration seed", () => {
  it("is identical, so the registry and institution_config cannot drift", () => {
    expect(seededRules()).toEqual(getProposedConfig("institution.rules").value);
  });
  it("is proposed, owned by the founder, and offers no reproductive, pregnancy or mental health pathway", () => {
    const e = getProposedConfig("institution.rules");
    expect(e.status).toBe("proposed");
    expect(e.owner).toBe("Founder");
    const paths = (e.value as { programme_pathways: string[] }).programme_pathways;
    for (const p of paths) expect(p).not.toMatch(/reproduct|pregnan|mental|fertil|menstru|contracept|mood|phq|gad/);
  });
});
