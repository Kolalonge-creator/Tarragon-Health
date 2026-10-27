import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";
import { THERAPY_WAVE_A_CONTENT } from "../therapy-content/wave-a-drafts";
import { mskSeedJson } from "../therapy-content/msk-drafts";

const S96 = /_s96_msk_programmes\.sql$/;
const S96B = /_s96b_non_paging_and_physio_marker\.sql$/;
const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

/** The JSON between a begin marker and the closing json tag in the S63 migration. */
function seeded(marker: string, filePattern: RegExp = /_s63_therapy_programmes.*\.sql$/): unknown {
  const files = readdirSync(MIGRATIONS).filter((f) => filePattern.test(f)).sort();
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    const match = new RegExp(`${marker}-begin[\\s\\S]*?\\$json\\$([\\s\\S]*?)\\$json\\$`).exec(sql);
    if (match?.[1]) return JSON.parse(match[1]);
  }
  throw new Error(`${marker} seed not found in any migration matching ${filePattern}`);
}

describe("S63 PROPOSED config mirrors the migration seeds", () => {
  it("therapy.exclusion_lists is list version 1 (S63) overlaid with list version 2 for the pain programmes (S96), proposed and owned by the CMO", () => {
    const e = getProposedConfig("therapy.exclusion_lists");
    const v1 = seeded("exclusion-lists-v1") as Record<string, unknown>;
    const v2 = seeded("exclusion-lists-v2", S96) as Record<string, unknown>;
    expect(Object.keys(v2).sort()).toEqual(["pain_back", "pain_hip", "pain_knee", "pain_neck"]);
    // the first S96 migration seeds the lists; the non-paging flag arrives in the follow-up migration (checked in its own test below)
    const stripFlag = (lists: Record<string, unknown>) =>
      JSON.parse(JSON.stringify(lists, (k, v) => (k === "nonPaging" ? undefined : v))) as Record<string, unknown>;
    expect({ ...v1, ...v2 }).toEqual(stripFlag(e.value as Record<string, unknown>));
    expect(e.status).toBe("proposed");
    expect(e.owner).toBe("CMO");
  });

  it("therapy.programme_config is identical to therapy_programme_config v2 (S96, the active one), proposed and owned by the CMO", () => {
    const e = getProposedConfig("therapy.programme_config");
    expect(seeded("programme-config-v2", S96)).toEqual(e.value);
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

  it("version 1 of both registry entries stays identical to what the S63 migration seeded (history)", () => {
    expect(getProposedConfig("therapy.exclusion_lists", "2026-10-08").value).toEqual(seeded("exclusion-lists-v1"));
    expect(getProposedConfig("therapy.programme_config", "2026-10-08").value).toEqual(seeded("programme-config-v1"));
  });

  it("the MSK session text and exercises in the migration are the content in the drafts file", () => {
    expect(seeded("msk-content-v1", S96)).toEqual(JSON.parse(JSON.stringify(mskSeedJson())));
  });

  it("the non-paging flag is on exactly the pain crisis items, and nothing else, in both the migration and the TS lists", () => {
    const sql = readFileSync(join(MIGRATIONS, readdirSync(MIGRATIONS).filter((f) => S96B.test(f))[0] as string), "utf8");
    const match = /msk-non-paging-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
    const fromSql = JSON.parse(match?.[1] ?? "{}") as Record<string, string[]>;
    const lists = getProposedConfig("therapy.exclusion_lists").value as unknown as Record<string, Array<{ code: string; route: string; nonPaging?: boolean }>>;
    for (const code of ["pain_back", "pain_neck", "pain_knee", "pain_hip"]) {
      const flagged = (lists[code] ?? []).filter((r) => r.nonPaging === true).map((r) => r.code).sort();
      expect(flagged).toEqual([...(fromSql[code] ?? [])].sort());
      expect((lists[code] ?? []).filter((r) => r.route === "crisis").map((r) => r.code).sort()).toEqual(flagged);
    }
    // no other programme (the mental-health crisis items above all) carries the flag
    for (const [code, rules] of Object.entries(lists)) {
      if (code.startsWith("pain_")) continue;
      expect(rules.filter((r) => r.nonPaging === true)).toEqual([]);
    }
  });

  it("the S96 follow-up migration signs, approves, confirms, attests and switches on nothing", () => {
    const sql = readFileSync(join(MIGRATIONS, readdirSync(MIGRATIONS).filter((f) => S96B.test(f))[0] as string), "utf8");
    const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(code).not.toMatch(/review_state\s*=\s*'approved'|status\s*=\s*'confirmed'|approved_by\s*=|set_go_live_guard|update public\.go_live_guards|attest_go_live_condition/i);
    expect(code).not.toMatch(/approve_therapy_programme_version|confirm_therapy_exclusion_list/);
  });

  it("the S96 migration signs, approves, confirms, attests and switches on nothing", () => {
    const files = readdirSync(MIGRATIONS).filter((f) => S96.test(f));
    expect(files.length).toBe(1);
    const sql = readFileSync(join(MIGRATIONS, files[0] as string), "utf8");
    const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(code).not.toMatch(/review_state\s*=\s*'approved'/i);
    expect(code).not.toMatch(/status\s*=\s*'confirmed'/i);
    expect(code).not.toMatch(/set_go_live_guard|update public\.go_live_guards|attest_go_live_condition|go_live_attestations/i);
    expect(code).not.toMatch(/approve_therapy_programme_version|confirm_therapy_exclusion_list/);
    expect(code).not.toMatch(/is_org_staff\s*\(/);
  });

  it("the migration signs, approves, confirms and switches on nothing", () => {
    const files = readdirSync(MIGRATIONS).filter((f) => /_s63_therapy_programmes.*\.sql$/.test(f));
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
