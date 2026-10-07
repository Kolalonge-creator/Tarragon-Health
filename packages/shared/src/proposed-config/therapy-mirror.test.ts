import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";
import { THERAPY_WAVE_A_CONTENT } from "../therapy-content/wave-a-drafts";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

/** The JSON between a begin marker and the closing json tag in the S63 migration. */
function seeded(marker: string): unknown {
  const files = readdirSync(MIGRATIONS).filter((f) => /_s63_.*\.sql$/.test(f)).sort();
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    const match = new RegExp(`${marker}-begin[\\s\\S]*?\\$json\\$([\\s\\S]*?)\\$json\\$`).exec(sql);
    if (match?.[1]) return JSON.parse(match[1]);
  }
  throw new Error(`${marker} seed not found in any S63 migration`);
}

describe("S63 PROPOSED config mirrors the migration seeds", () => {
  it("therapy.exclusion_lists is identical to therapy_exclusion_rules list version 1, proposed and owned by the CMO", () => {
    const e = getProposedConfig("therapy.exclusion_lists");
    expect(seeded("exclusion-lists-v1")).toEqual(e.value);
    expect(e.status).toBe("proposed");
    expect(e.owner).toBe("CMO");
  });

  it("therapy.programme_config is identical to therapy_programme_config v1, proposed and owned by the CMO", () => {
    const e = getProposedConfig("therapy.programme_config");
    expect(seeded("programme-config-v1")).toEqual(e.value);
    expect(e.status).toBe("proposed");
    expect(e.owner).toBe("CMO");
  });

  it("the Wave A session text in the migration is the text in the drafts file", () => {
    const fromSql = seeded("therapy-content-v1");
    const fromTs = THERAPY_WAVE_A_CONTENT.map((p) => ({
      code: p.code,
      clip: p.clip,
      sessions: p.sessions.map((s) => ({ ordinal: s.ordinal, title: s.title, kind: s.kind, body: s.body, durationSeconds: s.durationSeconds })),
    }));
    expect(fromSql).toEqual(fromTs);
  });

  it("the migration signs, approves, confirms and switches on nothing", () => {
    const files = readdirSync(MIGRATIONS).filter((f) => /_s63_.*\.sql$/.test(f));
    expect(files.length).toBe(1);
    const sql = readFileSync(join(MIGRATIONS, files[0] as string), "utf8");
    // the seeds only ever write draft rows and an off guard
    expect(sql).not.toMatch(/review_state\s*=\s*'approved'[^;]*insert/i);
    expect(sql).not.toMatch(/insert into public\.therapy_programme_versions[^;]*'approved'/i);
    expect(sql).not.toMatch(/insert into public\.therapy_exclusion_list_versions[^;]*'confirmed'/i);
    expect(sql).not.toMatch(/set_go_live_guard|update public\.go_live_guards/i);
    const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(code).not.toMatch(/is_org_staff\s*\(/);
  });
});
