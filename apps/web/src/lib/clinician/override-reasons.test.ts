import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { en } from "@tarragon/i18n";
import {
  BRIEF_FEEDBACK_LABEL_KEY,
  BRIEF_FEEDBACK_VALUES,
  OVERRIDE_REASON_CODES,
  OVERRIDE_REASON_LABEL_KEY,
  briefFeedbackSchema,
  codeAllowedWith,
  overrideReasonCodeSchema,
} from "./override-reasons";
import { isMissingFunction } from "@/lib/queries/clinician-alerts";

const WEB_SRC = join(__dirname, "../..");
const MIGRATIONS = join(__dirname, "../../../../../supabase/migrations");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

function w02Migration(): { path: string; sql: string } {
  const matches = readdirSync(MIGRATIONS).filter((n) => n.endsWith("_w02_override_reason_codes_and_brief_feedback.sql"));
  expect(matches).toHaveLength(1);
  const path = join(MIGRATIONS, matches[0]!);
  return { path, sql: readFileSync(path, "utf8") };
}

describe("override reason codes", () => {
  it("match the database enum exactly (migration found by suffix)", () => {
    const { sql } = w02Migration();
    const m = /create type public\.override_reason_code as enum \(([^)]*)\)/.exec(sql);
    expect(m).not.toBeNull();
    const values = m![1]!.split(",").map((v) => v.trim().replace(/'/g, ""));
    expect(values).toEqual([...OVERRIDE_REASON_CODES]);
  });

  it("have an i18n label for every code and every feedback value, with no dashes", () => {
    expect(Object.keys(OVERRIDE_REASON_LABEL_KEY).sort()).toEqual([...OVERRIDE_REASON_CODES].sort());
    expect(Object.keys(BRIEF_FEEDBACK_LABEL_KEY).sort()).toEqual([...BRIEF_FEEDBACK_VALUES].sort());
    for (const key of [...Object.values(OVERRIDE_REASON_LABEL_KEY), ...Object.values(BRIEF_FEEDBACK_LABEL_KEY)]) {
      expect(en[key]).toBeTruthy();
      expect(en[key]).not.toMatch(/[–—]/);
    }
    expect(overrideReasonCodeSchema.safeParse("made_up").success).toBe(false);
    expect(briefFeedbackSchema.safeParse("great").success).toBe(false);
  });

  it("uses the agreed override copy, and choosing a reason is optional", () => {
    expect(en["override.why"]).toBe("Why are you changing this?");
    expect(en["override.helper"]).toBe("Your reason helps us check our own rules. It is never used to rate you.");
    expect(en["override.choose"]).toContain("optional");
    expect(en["override.task_prompt"]).toContain("optional");
  });

  it("allows a code only with an unsafe or missing brief, mirroring the database check", () => {
    expect(codeAllowedWith("useful")).toBe(false);
    expect(codeAllowedWith("unsafe")).toBe(true);
    expect(codeAllowedWith("missing")).toBe(true);
    expect(w02Migration().sql).toContain("check (code is null or feedback in ('unsafe', 'missing'))");
  });

  it("recognises a missing database function so the override can fall back to the old update", () => {
    expect(isMissingFunction({ code: "PGRST202" })).toBe(true);
    expect(isMissingFunction({ code: "42883" })).toBe(true);
    expect(isMissingFunction({ message: "Could not find the function public.override_alert_level" })).toBe(true);
    expect(isMissingFunction({ code: "42501", message: "Only an active clinician" })).toBe(false);
  });
});

describe("the codes and their tables are not read by any ranking, queue, triage or score", () => {
  // The only application files allowed to mention the code type or the raw tables: the list itself, its test, and the screens that write them.
  const ALLOWED = new Set(
    [
      "lib/clinician/override-reasons.ts",
      "lib/clinician/override-reasons.test.ts",
      "lib/queries/clinician-alerts.ts",
      "lib/case-briefs/feedback-actions.ts",
      "components/case-brief-feedback.tsx",
      "app/(dashboard)/clinician/queue/forms.tsx",
      "app/(dashboard)/clinician/queue/actions.ts",
      "app/(dashboard)/clinician/escalations/[escalationId]/alert-override-control.tsx",
    ].map((p) => join(WEB_SRC, p)),
  );
  const WATCHED = /override_reason_code|overrideReasonCode|OverrideReasonCode|alert_override_events|clinical_task_override_reasons|\bcase_brief_feedback\b/;

  it("scans the whole web source tree and finds the files it should", () => {
    const files = walk(WEB_SRC);
    // a scan that found nothing would pass vacuously, so it must see the tree and the files it expects to allow
    expect(files.length).toBeGreaterThan(500);
    for (const allowed of ALLOWED) expect(files).toContain(allowed);
  });

  it("finds no mention outside the allowed files (and the sabotage check works: the allowed ones do mention it)", () => {
    const files = walk(WEB_SRC);
    const offenders = files.filter((f) => !ALLOWED.has(f) && WATCHED.test(readFileSync(f, "utf8"))).map((f) => relative(WEB_SRC, f));
    expect(offenders).toEqual([]);
    const mentioning = [...ALLOWED].filter((f) => WATCHED.test(readFileSync(f, "utf8")));
    expect(mentioning.length).toBeGreaterThan(3);
  });

  it("finds no other migration touching the raw tables or the enum", () => {
    const { path } = w02Migration();
    const others = readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql") && join(MIGRATIONS, n) !== path);
    expect(others.length).toBeGreaterThan(500);
    const offenders = others.filter((n) => /override_reason_code|alert_override_events|clinical_task_override_reasons|public\.case_brief_feedback/.test(readFileSync(join(MIGRATIONS, n), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("keeps the CMO away from raw rows: every raw table has one owner-only policy and the migration says so", () => {
    const { sql } = w02Migration();
    for (const table of ["alert_override_events", "clinical_task_override_reasons", "case_brief_feedback"]) {
      const policies = sql.match(new RegExp(`create policy \\w+ on public\\.${table} for select to authenticated\\s+using \\(clinician_profile_id = \\(select auth\\.uid\\(\\)\\)\\);`, "g"));
      expect(policies).toHaveLength(1);
    }
    expect(sql).not.toMatch(/create policy[^;]*credential_is_cmo/);
    expect(sql).toContain("having count(*) >= 3");
  });
});
