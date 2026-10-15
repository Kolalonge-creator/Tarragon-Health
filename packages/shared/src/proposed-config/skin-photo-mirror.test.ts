import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

describe("symptom.skin_photo_policy mirrors the migration seed", () => {
  it("is identical to skin_photo_policy_config version 1", () => {
    const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s59_skin_photos.sql"));
    if (!file) throw new Error("S59 skin photo migration not found");
    const m = /skin-photo-policy-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
    if (!m?.[1]) throw new Error("skin photo policy seed not found");
    expect(JSON.parse(m[1])).toEqual(getProposedConfig("symptom.skin_photo_policy").value);
  });
});
