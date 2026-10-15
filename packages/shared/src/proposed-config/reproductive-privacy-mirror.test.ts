import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig, type ConfigValue } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

/** The rules the latest S66 migration seeds, between its begin and end markers. */
function seededRules(): Record<string, unknown> {
  const files = readdirSync(MIGRATIONS).filter((f) => /_s66[a-z]?_.*\.sql$/.test(f)).sort();
  let latest: string | null = null;
  for (const f of files) {
    const m = /reproductive-privacy-rules(?:-v\d+)?-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
    if (m?.[1]) latest = m[1];
  }
  if (!latest) throw new Error("reproductive privacy rules seed not found in any S66 migration");
  return JSON.parse(latest) as Record<string, unknown>;
}

describe("reproductive_privacy.rules mirrors the migration seed", () => {
  it("is identical, so the registry and reproductive_privacy_config cannot drift", () => {
    expect(seededRules()).toEqual(getProposedConfig("reproductive_privacy.rules").value);
  });
  it("is proposed, owned by the founder and counsel, with exactly the keys the database reads", () => {
    const e = getProposedConfig("reproductive_privacy.rules");
    expect(e.status).toBe("proposed");
    expect(e.owner).toBe("Founder and counsel");
    expect(Object.keys(e.value as object).sort()).toEqual(["deletion_grace_days", "report_window_months", "sealed_retention_years"]);
  });
});

describe("private_section.lock", () => {
  it("is proposed, on by default (founder decision) and carries every key the lock reads", () => {
    const e = getProposedConfig<Record<string, ConfigValue>>("private_section.lock");
    expect(e.status).toBe("proposed");
    expect(e.value.on_by_default).toBe(true);
    expect(Object.keys(e.value).sort()).toEqual(["free_attempts", "lockout_seconds", "on_by_default", "pbkdf2_iterations", "pin_max_digits", "pin_min_digits", "relock_after_background_seconds"]);
  });
});
