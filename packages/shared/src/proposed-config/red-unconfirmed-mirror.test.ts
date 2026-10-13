import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROPOSED_CONFIG } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seeded(): Record<string, unknown> {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s13r4_critical_ladder_and_red_outreach.sql"));
  if (!file) throw new Error("S13 R4 migration not found");
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const match = /red-unconfirmed-rules-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
  if (!match?.[1]) throw new Error("red unconfirmed seed not found in the migration");
  return JSON.parse(match[1]) as Record<string, unknown>;
}

const v4 = () => PROPOSED_CONFIG.find((c) => c.key === "notifications.rules" && c.version === 4);

describe("notifications.rules v4 mirrors the migration seed", () => {
  it("redUnconfirmed is identical, so the registry and notification_rules_config cannot drift", () => {
    expect((v4()?.value as { redUnconfirmed: unknown }).redUnconfirmed).toEqual(seeded());
  });

  it("carries the CMO's 30 minutes and is owned by the CMO, proposed until signed", () => {
    expect(seeded()["unconfirmedMinutes"]).toBe(30);
    expect(v4()?.owner).toBe("CMO");
    expect(v4()?.status).toBe("proposed");
  });

  it("keeps every v3 setting unchanged", () => {
    const v3 = PROPOSED_CONFIG.find((c) => c.key === "notifications.rules" && c.version === 3)?.value as Record<string, unknown>;
    const { redUnconfirmed: _ignored, ...rest } = v4()?.value as Record<string, unknown>;
    expect(rest).toEqual(v3);
  });

  it("the drift test discriminates: a changed value would not match", () => {
    expect({ ...seeded(), unconfirmedMinutes: 10 }).not.toEqual((v4()?.value as { redUnconfirmed: unknown }).redUnconfirmed);
  });
});
