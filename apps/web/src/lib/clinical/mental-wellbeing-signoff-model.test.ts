import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { en } from "@tarragon/i18n";
import { getProposedConfig } from "@tarragon/shared";
import type { GuardStatus } from "@/lib/go-live/model";
import { ATTESTATION_SLOTS, INSIGHTS_GUARD, PANIC_GUARD, pendingAttestations, wordingFingerprint, wordingLines, worklistRulesView } from "./mental-wellbeing-signoff-model";

const MIGRATIONS = join(process.cwd(), "..", "..", "supabase", "migrations");

function shipped(fn: string): string {
  let found: string | null = null;
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) {
    const m = new RegExp(`function private\\.${fn}\\(\\)[\\s\\S]*?select '([0-9a-f]{12})'::text`).exec(readFileSync(join(MIGRATIONS, f), "utf8"));
    if (m?.[1]) found = m[1];
  }
  if (!found) throw new Error(`no migration defines private.${fn}()`);
  return found;
}

const guard = (key: string, conditions: { code: string; met: boolean }[]): GuardStatus => ({
  key, label: key, blocks: "", condition_text: "", switch_role: "cmo", enforced_in: [], not_enforced_in: "", is_on: false, changed_at: null, changed_by_name: null, change_note: null,
  conditions: conditions.map((c) => ({ code: c.code, label: c.code, met: c.met, source: "attestation" as const, detail: null })), all_met: false, recent: [],
});

describe("the fingerprint the CMO's attestation is bound to", () => {
  it("is the one the database holds, for the calm tool and for the patterns view", () => {
    expect(wordingFingerprint("panic.")).toBe(shipped("s56b_panic_fingerprint"));
    expect(wordingFingerprint("insights.")).toBe(shipped("s56b_insights_fingerprint"));
  });
  it("changes when one word changes (so an old attestation cannot cover new wording)", () => {
    const cat = { ...(en as Record<string, string>) };
    const before = wordingFingerprint("panic.", cat);
    cat["panic.intro_1"] = `${cat["panic.intro_1"]} Really.`;
    expect(wordingFingerprint("panic.", cat)).not.toBe(before);
    expect(wordingFingerprint("insights.", cat)).toBe(wordingFingerprint("insights."));
  });
  it("the panel shows every panic.* string, in key order", () => {
    const lines = wordingLines("panic.");
    expect(lines.length).toBe(Object.keys(en).filter((k) => k.startsWith("panic.")).length);
    expect(lines.map((l) => l.key)).toEqual([...lines.map((l) => l.key)].sort());
  });
});

describe("pending attestations", () => {
  it("lists only the unmet slots and never one for a condition the database does not report", () => {
    const guards = [
      guard(PANIC_GUARD, [{ code: "panic_wording_signed", met: true }, { code: "panic_accessibility_checked", met: false }]),
      guard(INSIGHTS_GUARD, [{ code: "insights_wording_signed", met: false }]),
    ];
    expect(pendingAttestations(guards).map((s) => s.code).sort()).toEqual(["insights_wording_signed", "panic_accessibility_checked"]);
    expect(pendingAttestations([])).toEqual([]);
  });
  it("every slot names a guard and a condition the migration wires", () => {
    const sql = readdirSync(MIGRATIONS).filter((f) => /_s56b_wellbeing_guards/.test(f)).map((f) => readFileSync(join(MIGRATIONS, f), "utf8")).join("\n");
    for (const s of ATTESTATION_SLOTS) {
      expect([s.guard, sql.includes(`'${s.guard}'`)]).toEqual([s.guard, true]);
      expect([s.code, sql.includes(`'${s.code}'`)]).toEqual([s.code, true]);
    }
  });
});

describe("worklist rules in words", () => {
  const v1 = getProposedConfig("mental_health.worklist_rules").value;
  it("reads every number of the PROPOSED draft into a sentence, so the words signed are the values that apply", () => {
    const view = worklistRulesView(v1);
    expect(view).not.toBeNull();
    const text = (view?.lines ?? []).join("\n");
    expect(text).toContain("rose by 5 or more");
    expect(text).toContain("rose by 4 or more");
    expect(text).toContain("within 120 days");
    expect(text).toContain("more than 14 days");
    expect(text).toContain("under 5.5 hours");
    expect(text).toContain("none for 10 days");
    expect(text).toContain("48 hours");
    expect(text).toContain("72 hours");
    expect(text).toContain("At most 100 patients");
  });
  it("says a switched-off rule is switched off, and refuses a draft with a missing number", () => {
    const off = worklistRulesView({ ...(v1 as object), missed_checkins: { ...(v1 as { missed_checkins: object }).missed_checkins, enabled: false } });
    expect(off?.lines.join("\n")).toContain("Missed check-ins: switched off.");
    expect(worklistRulesView({ ...(v1 as object), max_rows: undefined })).toBeNull();
    expect(worklistRulesView(null)).toBeNull();
  });
});
