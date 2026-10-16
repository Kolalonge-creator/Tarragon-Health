import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROPOSED_CONFIG } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");
const sql = () => {
  const f = readdirSync(MIGRATIONS).find((n) => n.endsWith("_fu_notify_rules_v5_and_retention_config.sql"));
  if (!f) throw new Error("FU-notify migration A not found");
  return readFileSync(join(MIGRATIONS, f), "utf8");
};
const between = (marker: string) => {
  const m = new RegExp(`${marker}-begin[\\s\\S]*?\\$json\\$([\\s\\S]*?)\\$json\\$`).exec(sql());
  if (!m?.[1]) throw new Error(`${marker} seed not found`);
  return JSON.parse(m[1]) as Record<string, unknown>;
};
const entry = (key: string, version: number) => PROPOSED_CONFIG.find((c) => c.key === key && c.version === version);

describe("notifications.rules v5 mirrors the migration seed", () => {
  const v5 = () => entry("notifications.rules", 5);
  it("redUnconfirmed is identical to the seed, so the registry and notification_rules_config cannot drift", () => {
    expect((v5()?.value as { redUnconfirmed: unknown }).redUnconfirmed).toEqual(between("red-unconfirmed-rules-v5"));
  });
  it("carries the CMO answers: delivered does not confirm, could-not-get-care waits, 5 and 6 kept, owner CMO", () => {
    const r = between("red-unconfirmed-rules-v5");
    expect(r["deliveredCountsAsConfirmed"]).toBe(false);
    expect(r["couldNotGetCareOutreachNow"]).toBe(false);
    expect(r["undeliveredMinutes"]).toBe(5);
    expect(r["expireHours"]).toBe(6);
    expect(r["unconfirmedMinutes"]).toBe(30);
    expect(v5()?.owner).toBe("CMO");
    expect(v5()?.status).toBe("proposed");
  });
  it("changes nothing else from v4", () => {
    const { redUnconfirmed: a, ...rest5 } = v5()?.value as Record<string, unknown> & { redUnconfirmed: Record<string, unknown> };
    const { redUnconfirmed: b, ...rest4 } = entry("notifications.rules", 4)?.value as Record<string, unknown> & { redUnconfirmed: Record<string, unknown> };
    expect(rest5).toEqual(rest4);
    const diff = Object.keys(a).filter((k) => a[k] !== b[k]).sort();
    expect(diff).toEqual(["couldNotGetCareOutreachNow", "deliveredCountsAsConfirmed"]);
  });
  it("discriminates: a changed value would not match", () => {
    expect({ ...between("red-unconfirmed-rules-v5"), deliveredCountsAsConfirmed: true }).not.toEqual((v5()?.value as { redUnconfirmed: unknown }).redUnconfirmed);
  });
});

describe("privacy.webhook_inbox_retention mirrors the migration seed", () => {
  it("is identical and born off", () => {
    const seed = between("provider-event-retention");
    expect(entry("privacy.webhook_inbox_retention", 1)?.value).toEqual(seed);
    expect(seed["purgeEnabled"]).toBe(false);
    expect(seed["rejectedDays"]).toBe(30);
    expect(seed["verifiedRawBodyDays"]).toBe(90);
  });
});

describe("credentialing.rules v6 records evidence retention only", () => {
  it("is version 5 plus the one key (employment plus 6 years), purge still off", () => {
    const v5 = entry("credentialing.rules", 5)?.value as Record<string, unknown>;
    const v6 = entry("credentialing.rules", 6)?.value as Record<string, unknown>;
    const { verification_evidence_retention_years_after_employment: years, ...rest } = v6;
    expect(years).toBe(6);
    expect(rest).toEqual(v5);
    expect(v6["document_purge_enabled"]).toBe(false);
  });
});
