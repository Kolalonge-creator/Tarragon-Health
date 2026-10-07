import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

describe("directory.verification_cadence mirrors the migration seed", () => {
  it("is identical to the directory_verification_config seed", () => {
    const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s36g_directory_freshness.sql"));
    if (!file) throw new Error("S36g migration not found");
    const match = /directory-cadence-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
    if (!match?.[1]) throw new Error("directory cadence seed not found in the migration");
    expect(JSON.parse(match[1])).toEqual(getProposedConfig("directory.verification_cadence").value);
  });

  it("is proposed, owned and unsigned (no sign-off was created)", () => {
    const entry = getProposedConfig("directory.verification_cadence");
    expect(entry.status).toBe("proposed");
    expect(entry.owner).toBe("Founder");
  });
});
