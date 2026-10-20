/**
 * The task types page states the skills the database adds to a task (`private.task_extra_competencies`, OQ-433). That function is the
 * source of truth; this guard reads its SQL and fails if the page's constants say something different, so the copy cannot drift.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ALWAYS_EXTRA_SKILLS, SOMETIMES_EXTRA_SKILLS_NOTE, skillsNeeded } from "./task-types";

const DIR = path.resolve(__dirname, "../../../../../supabase/migrations");

function extraCompetenciesFunction(): string {
  const file = readdirSync(DIR).find((f) => f.endsWith("_task_queue_gaps_symptom_producer_prescribing_lead_competency.sql"));
  if (file === undefined) throw new Error("the OQ-432/433/435 migration was not found");
  const sql = readFileSync(path.join(DIR, file), "utf8");
  const start = sql.indexOf("create function private.task_extra_competencies");
  if (start < 0) throw new Error("private.task_extra_competencies not found");
  return sql.slice(start, sql.indexOf("$$;", sql.indexOf("as $$", start)));
}

describe("the task types page matches private.task_extra_competencies", () => {
  const body = extraCompetenciesFunction();

  it("adds prescribing to every pharmacy flag task, and to nothing else unconditionally", () => {
    expect(body).toMatch(/when p_type = 'pharmacy_flag_review' then array\['prescribing'\]/);
    expect(Object.keys(ALWAYS_EXTRA_SKILLS)).toEqual(["pharmacy_flag_review"]);
    expect(ALWAYS_EXTRA_SKILLS["pharmacy_flag_review"]).toEqual(["prescribing"]);
  });

  it("adds prescribing to an admin task only for the prescription subtype", () => {
    expect(body).toMatch(/p_type = 'admin_clinical' and coalesce\(p_dedup_key, ''\) ~ '\^\(repeat_\)\?prescription:'/);
    expect(Object.keys(SOMETIMES_EXTRA_SKILLS_NOTE)).toEqual(["admin_clinical"]);
    expect(SOMETIMES_EXTRA_SKILLS_NOTE["admin_clinical"]).toContain("when the work is a prescription");
  });

  it("shows prescribing in the skills line of a pharmacy flag, and merges it with the type's own list", () => {
    expect(skillsNeeded({ code: "pharmacy_flag_review", required_competencies: [] })).toBe("prescribing");
    expect(skillsNeeded({ code: "titration_signoff", required_competencies: ["prescribing", "hypertension"] })).toBe("hypertension, prescribing");
    expect(skillsNeeded({ code: "admin_clinical", required_competencies: [] })).toBe("None specific");
  });
});
