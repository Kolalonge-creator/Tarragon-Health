import { describe, it, expect } from "@jest/globals";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SHARE_SECTIONS } from "@/lib/queries/record-shares";

/** S46d wiring that cannot be exercised without a database: scanned from source so a refactor cannot quietly drop a lock. */
const root = join(__dirname, "../../../../..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");
const migration = () => {
  const dir = join(root, "supabase", "migrations");
  return readFileSync(join(dir, readdirSync(dir).find((f) => f.endsWith("_s46d_health_report_completion.sql")) as string), "utf8");
};

describe("share link for the signed report", () => {
  it("is a section a patient can pick, offered only when a signed report exists, and refused by the database otherwise", () => {
    expect(SHARE_SECTIONS).toContain("health_report");
    expect(read("apps/web/src/app/(dashboard)/patient/share-records/share-controls.tsx")).toContain('section !== "health_report" || hasSignedReport');
    const sql = migration();
    expect(sql).toContain("there is no signed yearly report to share");
    expect(sql).toMatch(/hr\.status = ''signed'' and hr\.signed_by is not null and hr\.signed_at is not null/);
  });

  it("builds the body from the latest SIGNED report only, drops risk, questionnaires, reproductive screening, the doctor's text and summary counts", () => {
    const sql = migration();
    const fn = sql.slice(sql.indexOf("create function private.health_report_share_body"), sql.indexOf("do $$", sql.indexOf("create function private.health_report_share_body")));
    expect(fn).toContain("status = 'signed' and signed_by is not null and signed_at is not null");
    expect(fn).toContain("'templateSummary'");
    expect(fn).toContain("{risk}");
    expect(fn).toContain("{questionnaires}");
    expect(fn).toContain("reproductive");
    expect(fn).toContain("private.report_excluded_code");
    expect(fn).not.toContain("summary_text");
    expect(fn).not.toContain("correction_note");
    // it is private and reachable only through the share door
    expect(sql).toContain("revoke all on function private.health_report_share_body(uuid) from public, anon, authenticated;");
  });

  it("Care Circle supporters are not part of it: the share is created by the patient only and nothing here reads the circle", () => {
    expect(migration().replace(/^\s*--.*$/gm, "")).not.toMatch(/care_circle|circle_member|supporter/i);
  });

  it("the patches refuse to guess: each anchor must match exactly once", () => {
    const sql = migration();
    expect(sql).toContain("an anchor is missing or repeated, refusing to guess");
    expect(sql).toContain("the anchor is missing or repeated, refusing to guess");
  });
});

describe("the anti-HBs add-on", () => {
  it("every result is held for a clinician (the classifier is patched by anchor), a draft lab sign-off is created and nothing is priced", () => {
    const sql = migration();
    expect(sql).toContain("holdForReview");
    expect(sql).toContain("classify_lab_result (%): the anchor is missing or repeated, refusing to guess");
    expect(sql).toContain("insert into public.lab_panel_signoffs");
    expect(sql).not.toMatch(/insert into public\.(lab_test_prices|service_products|panel_bundles|screen_types)/i);
  });
});

describe("sign-off hub, serology threshold and report settings", () => {
  it("both server actions refuse anyone but the Chief Medical Officer before calling the database, which refuses again", () => {
    const a = read("apps/web/src/app/(dashboard)/clinician/health-report-config/actions.ts");
    expect(a.match(/canAssignCases\(await getCurrentClinicalStaff\(\)\)/g)).toHaveLength(2);
    expect(a).toContain('"sign_health_report_config"');
    expect(a).toContain('"sign_serology_rule_threshold"');
    const sql = migration();
    expect(sql).toContain("doctor_tier = 'chief_medical_officer'");
    expect(sql).toContain("revoke all on function public.sign_serology_rule_threshold(uuid) from public, anon;");
  });

  it("nothing in this change signs anything or flips a go-live guard", () => {
    const sql = migration();
    expect(sql).not.toMatch(/update public\.go_live|app_config|perform public\.sign_|select public\.sign_/i);
    expect(sql).not.toMatch(/approved_by\s*=\s*\(?select/i);
  });
});
