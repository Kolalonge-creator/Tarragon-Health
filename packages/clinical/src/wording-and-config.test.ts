import { describe, expect, it } from "@jest/globals";
import { en } from "@tarragon/i18n";
import { getProposedConfig } from "@tarragon/shared";
import { BP_CARE_V1, TRIAGE_MESSAGE_KEYS, messageKeyFor } from "./index";

const catalogues = { en: en as Record<string, string> };

/** INV-07: a notification never names a condition, a reading or a result, and carries no number. */
const NOTIFICATION_FORBIDDEN: RegExp[] = [
  /\bblood\b/i, /\bpressure\b/i, /\bbp\b/i, /\bhypertens\w*/i, /\bpulse\b/i, /\bmmhg\b/i, /\breadings?\b/i,
  /\bresults?\b/i, /\bconditions?\b/i, /\bsymptoms?\b/i, /\bheadache\b/i, /\bchest\b/i, /\bfaint\w*/i, /\bdizz\w*/i,
  /\bhigh\b/i, /\blow\b/i, /\burgent\b/i, /\bemergency\b/i, /\bdanger\w*/i, /\bred\b/i, /\bamber\b/i, /\bgreen\b/i,
  /\bmedic\w*/i, /\bdoses?\b/i, /\badherence\b/i, /\bmissed\b/i, /\bpregnan\w*/i, /\bdoctor\b/i, /\d/,
];

const notifyKeysUsed = BP_CARE_V1.rules.flatMap((r) => r.actions.flatMap((a) => (a.kind === "create_task" ? [a.notifyKey] : [])));

describe("triage wording", () => {
  it("every explanation code a rule can return has a title and body in English", () => {
    const codes = new Set(BP_CARE_V1.rules.map((r) => r.explanationKey));
    codes.add(BP_CARE_V1.params.rejected.explanationKey);
    codes.add(BP_CARE_V1.params.rejected.redFlagGuidanceCode);
    for (const code of codes) {
      const keys = messageKeyFor(code);
      expect([code, keys === null]).toEqual([code, false]);
      for (const locale of ["en"] as const) {
        expect([code, locale, (catalogues[locale][keys!.title] ?? "").length > 0]).toEqual([code, locale, true]);
        expect([code, locale, (catalogues[locale][keys!.body] ?? "").length > 0]).toEqual([code, locale, true]);
      }
    }
  });

  it("every action code and message key referenced by a rule resolves", () => {
    for (const rule of BP_CARE_V1.rules) {
      for (const a of rule.actions) {
        if (a.kind === "show_emergency_guidance" || a.kind === "show_message" || a.kind === "prompt_recheck") {
          expect([rule.id, a.code, messageKeyFor(a.code) === null]).toEqual([rule.id, a.code, false]);
        }
      }
    }
    for (const keys of Object.values(TRIAGE_MESSAGE_KEYS)) {
      expect(en).toHaveProperty([keys.title]);
      expect(en).toHaveProperty([keys.body]);
    }
  });

  it("safety case 20: the notification for an amber task names no condition and no reading", () => {
    expect(notifyKeysUsed.length).toBeGreaterThan(0);
    for (const rule of BP_CARE_V1.rules.filter((r) => r.grade === "amber")) {
      const keys = rule.actions.flatMap((a) => (a.kind === "create_task" ? [a.notifyKey] : []));
      for (const key of keys) {
        const mk = messageKeyFor(key);
        expect(mk).not.toBeNull();
        for (const locale of ["en"] as const) {
          for (const text of [catalogues[locale][mk!.title], catalogues[locale][mk!.body]]) {
            const hits = NOTIFICATION_FORBIDDEN.filter((re) => re.test(text)).map((re) => re.source);
            expect([rule.id, locale, text, hits]).toEqual([rule.id, locale, text, []]);
          }
        }
      }
    }
  });

  it("the notification lint itself discriminates: a notification that names a reading is caught", () => {
    const bad = "Your blood pressure reading is high";
    expect(NOTIFICATION_FORBIDDEN.some((re) => re.test(bad))).toBe(true);
    expect(NOTIFICATION_FORBIDDEN.some((re) => re.test("A new task is waiting for you in TarragonHealth."))).toBe(false);
  });

  it("emergency guidance sends the patient to the nearest hospital and prints no phone number", () => {
    for (const code of ["EMG-001", "EMG-001L"]) {
      const mk = messageKeyFor(code)!;
      for (const locale of ["en"] as const) {
        const body = catalogues[locale][mk.body];
        expect(body).toMatch(/nearest hospital/i);
        expect(body).not.toMatch(/\d{3,}/);
        expect(body).not.toMatch(/your doctor/i);
      }
    }
  });
});

describe("configuration links", () => {
  it("the registry entry names this rule set and version", () => {
    const entry = getProposedConfig<{ code: string; ruleSetVersion: number; adultAgeYears: number }>("triage.bp_rule_set");
    expect(entry.value.code).toBe(BP_CARE_V1.code);
    expect(entry.value.ruleSetVersion).toBe(BP_CARE_V1.version);
    expect(entry.value.adultAgeYears).toBe(BP_CARE_V1.params.minAdultAgeYears);
    expect(entry.status).toBe("proposed");
  });

  it("the silence and adherence lines equal the registered PROPOSED values", () => {
    expect(getProposedConfig<number>("triage.silence_rule_days").value).toBe(BP_CARE_V1.params.silence.days);
    expect(getProposedConfig<{ percent: number }>("adherence.threshold").value.percent).toBe(BP_CARE_V1.params.adherence.minPercent);
  });

  it("the bundled rule set is a draft: nobody has signed it", () => {
    expect(BP_CARE_V1.status).toBe("draft");
  });
});

describe("server seed", () => {
  it("the version 2 draft in the migration is identical to the bundled rule set", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const dir = new URL("../../../supabase/migrations/", import.meta.url);
    const file = readdirSync(dir).find((f) => f.endsWith("_s11c_bp_rule_set_v2_cmo_decisions.sql"));
    expect(file).toBeDefined();
    const sql = readFileSync(new URL(file!, dir), "utf8");
    const match = /\$rules_json\$([\s\S]*?)\$rules_json\$/.exec(sql);
    expect(match).not.toBeNull();
    expect(JSON.parse(match![1])).toEqual(JSON.parse(JSON.stringify(BP_CARE_V1)));
  });
});
