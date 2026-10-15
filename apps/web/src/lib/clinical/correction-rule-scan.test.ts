import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { SUPERSEDING_TABLES } from "@tarragon/shared";

/**
 * S05b: one supersede-with-status rule for corrections (docs/design/S05b.md).
 *
 * A clinical value that was relied on is never edited or hard-deleted from application code. A correction goes through
 * `public.correct_clinical_value`, which keeps the original and records the actor and the reason. The database enforces this on the
 * tables in SUPERSEDING_TABLES (a trigger refuses the edit even for the service role), so this scan catches the mistake at review
 * time instead of at runtime, and covers the tables where the database cannot tell a workflow update from a value edit.
 *
 * Strict tables: any `.update(`, `.delete(` or `.upsert(` after `.from("<table>")` fails.
 * Watched tables: the same call fails unless it is listed below with the reason it is a workflow update and not a value edit.
 */
const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");

const STRICT_TABLES: readonly string[] = [...SUPERSEDING_TABLES, "lab_result_items"];
const WATCHED_TABLES = ["screening_results", "lab_result_documents", "clinical_encounter_notes", "medications"] as const;

type Allowed = { file: string; table: string; count: number; why: string };

/** Workflow updates: they move a status, a link or a derived summary, never the recorded value itself. */
const ALLOWED: Allowed[] = [
  { file: "apps/web/src/app/(dashboard)/clinician/patients/[patientId]/screening-result-actions.ts", table: "screening_results", count: 2, why: "follow-up action and patient-informed stamp; the result value is not touched" },
  { file: "apps/web/src/lib/queries/medications.ts", table: "medications", count: 1, why: "stopping a medicine (is_active, stopped_at, stopped_reason) is a lifecycle step" },
  { file: "apps/web/src/lib/queries/lab-result-documents.ts", table: "lab_result_documents", count: 2, why: "links a document to an order and records which document it supersedes" },
  { file: "apps/web/src/lib/lab-reports/extraction-actions.ts", table: "lab_result_documents", count: 2, why: "AI summary status for the draft; the document and its values are not touched" },
  { file: "apps/web/src/lib/lab-results/actions.ts", table: "lab_result_documents", count: 1, why: "clinician review stamp and the interpretation sent to the patient" },
];

/**
 * Known debt, tracked: these replace the stored file of a result document in place. The rule says a replacement is a new document with
 * supersedes_document_id (which already exists). The count may only go down; fix them in S05b-c and remove the entries.
 */
const KNOWN_DEBT: Allowed[] = [
  { file: "apps/web/src/app/api/mobile/lab-result-replace/route.ts", table: "lab_result_documents", count: 1, why: "replaces file_path in place" },
  { file: "apps/web/src/lib/lab-results/actions.ts", table: "lab_result_documents", count: 1, why: "replaces file_path in place" },
];

const SCAN_DIRS = ["apps/web/src", "apps/mobile/src", "apps/console/src", "supabase/functions", "packages/staff-core/src", "packages/shared/src", "packages/ui/src", "packages/auth/src"];

function sourceFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    if (entry === "node_modules" || entry === ".next") return [];
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) && !/database\.types\.ts$/.test(entry) ? [full] : [];
  });
}

const tableList = [...STRICT_TABLES, ...WATCHED_TABLES].join("|");
const CALL = new RegExp(`\\.from\\(\\s*["'\`](${tableList})["'\`]\\s*\\)\\s*\\.(update|delete|upsert)\\s*\\(`, "g");

type Hit = { file: string; table: string; verb: string; line: number };

function findHits(): Hit[] {
  const hits: Hit[] = [];
  for (const dir of SCAN_DIRS) {
    for (const full of sourceFiles(join(REPO_ROOT, dir))) {
      const text = readFileSync(full, "utf8");
      for (const m of text.matchAll(CALL)) {
        hits.push({
          file: relative(REPO_ROOT, full),
          table: m[1],
          verb: m[2],
          line: text.slice(0, m.index).split("\n").length,
        });
      }
    }
  }
  return hits;
}

describe("S05b correction rule: no direct edit or delete of a recorded clinical value", () => {
  const hits = findHits();

  it("never updates, deletes or upserts a strict table from application code", () => {
    const offenders = hits.filter((h) => STRICT_TABLES.includes(h.table)).map((h) => `${h.file}:${h.line} ${h.verb} ${h.table}`);
    expect(offenders).toEqual([]);
  });

  it("only touches a watched table where it is a listed workflow update", () => {
    const counts = new Map<string, number>();
    for (const h of hits.filter((x) => !STRICT_TABLES.includes(x.table))) {
      const key = `${h.file}|${h.table}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const offenders: string[] = [];
    for (const [key, n] of counts) {
      const [file, table] = key.split("|");
      const allowed = [...ALLOWED, ...KNOWN_DEBT].filter((a) => a.file === file && a.table === table).reduce((s, a) => s + a.count, 0);
      if (n > allowed) offenders.push(`${file} ${table}: ${n} direct write(s), ${allowed} listed`);
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the allow list honest: every entry still exists (remove it when the code goes)", () => {
    const stale: string[] = [];
    for (const a of [...ALLOWED, ...KNOWN_DEBT]) {
      const n = hits.filter((h) => h.file === a.file && h.table === a.table).length;
      const listed = [...ALLOWED, ...KNOWN_DEBT].filter((x) => x.file === a.file && x.table === a.table).reduce((s, x) => s + x.count, 0);
      if (n < listed) stale.push(`${a.file} ${a.table}: ${n} found, ${listed} listed`);
    }
    expect([...new Set(stale)]).toEqual([]);
  });

  it("the scan itself can see a violation (sabotage check)", () => {
    const sample = `await supabase\n  .from("vitals_readings")\n  .update({ weight_kg: 1 })\n  .eq("id", id);`;
    expect([...sample.matchAll(CALL)].length).toBe(1);
    const fine = `await supabase.from("vitals_readings").insert({ weight_kg: 1 });`;
    expect([...fine.matchAll(CALL)].length).toBe(0);
  });
});
