import * as fs from "node:fs";
import * as path from "node:path";
import {
  fallbackControlledMedicineList,
  loadControlledMedicineList,
  matchControlledMedicineTerm,
  parseControlledMedicineList,
} from "./controlled-medicine-list";
import { CONTROLLED_MEDICINE_FALLBACK, CONTROLLED_MEDICINE_FALLBACK_VERSION } from "./controlled-medicine-terms.generated";
import { SEED_MIGRATION, parseSeedTerms, renderFallbackFile } from "./controlled-medicine-fallback-codegen";
import { controlledSubstanceInfo } from "./controlled-substances";

const repoRoot = path.resolve(__dirname, "../../../../..");
const migrations = path.join(repoRoot, "supabase/migrations");
const seedSql = fs.readFileSync(path.join(migrations, SEED_MIGRATION), "utf8");
const seed = parseSeedTerms(seedSql);

describe("loadControlledMedicineList reads the database list and never throws", () => {
  const dbList = { version: 12, terms: [{ term: "proofium", tier: "restricted", label: "Proof class" }] };

  it("returns the database list when the call works", async () => {
    const list = await loadControlledMedicineList({ rpc: async () => ({ data: dbList, error: null }) } as never);
    expect(list).toMatchObject({ version: 12, source: "database" });
    expect(controlledSubstanceInfo("Proofium 5mg", list)?.label).toBe("Proof class");
  });

  it("an edit in the table changes the guard with no code change: the same call, a different database answer, a different result", async () => {
    const before = await loadControlledMedicineList({ rpc: async () => ({ data: { version: 1, terms: [] }, error: null }) } as never);
    const after = await loadControlledMedicineList({ rpc: async () => ({ data: dbList, error: null }) } as never);
    expect(controlledSubstanceInfo("Proofium", before)).toBeNull();
    expect(controlledSubstanceInfo("Proofium", after)).not.toBeNull();
  });

  it("falls back to the generated list on an error, a throw, or a malformed answer", async () => {
    const cases = [
      { rpc: async () => ({ data: null, error: { message: "down" } }) },
      { rpc: async () => { throw new Error("boom"); } },
      { rpc: async () => ({ data: { terms: "nope" }, error: null }) },
      { rpc: async () => ({ data: { version: 1, terms: [{ term: "x", tier: "schedule2", label: "x" }] }, error: null }) },
    ];
    for (const client of cases) {
      const list = await loadControlledMedicineList(client as never);
      expect(list.source).toBe("fallback");
      expect(controlledSubstanceInfo("Morphine", list)).not.toBeNull();
    }
  });

  it("an empty database list is a real answer, not a failure", () => {
    expect(parseControlledMedicineList({ version: 3, terms: [] })).toMatchObject({ source: "database", terms: [] });
  });
});

describe("the generated fallback is generated from the migration seed, not typed", () => {
  it("is byte-for-byte what the generator writes from the seed", () => {
    const file = fs.readFileSync(path.join(__dirname, "controlled-medicine-terms.generated.ts"), "utf8");
    expect(file).toBe(renderFallbackFile(seed, `the seed in supabase/migrations/${SEED_MIGRATION}`, seed.length));
  });

  it("has the 60 seeded terms at the seed version, and the fallback list is built from them", () => {
    expect(seed).toHaveLength(60);
    expect(CONTROLLED_MEDICINE_FALLBACK_VERSION).toBe(60);
    expect(fallbackControlledMedicineList().terms).toBe(CONTROLLED_MEDICINE_FALLBACK);
    expect(new Set(CONTROLLED_MEDICINE_FALLBACK.map((t) => t.term))).toEqual(new Set(seed.map((t) => t.term)));
  });

  it("every seeded term is flagged by the guard with its own tier and label", () => {
    for (const t of seed) {
      expect({ term: t.term, hit: matchControlledMedicineTerm(fallbackControlledMedicineList(), t.term)?.term }).toEqual({ term: t.term, hit: t.term });
    }
  });

  it("the seed parser refuses a migration it cannot read (so a changed layout fails loudly instead of shrinking the list)", () => {
    expect(() => parseSeedTerms("nothing here")).toThrow();
    expect(() => parseSeedTerms("-- BEGIN SEED controlled_medicine_terms\n  garbage\n-- END SEED controlled_medicine_terms")).toThrow(/unreadable/);
  });
});

/**
 * One list. This scan fails if a second hand-typed copy of the list appears: a source file holding many of the controlled terms (outside the generated
 * fallback, tests and the known unrelated vocabularies below), or a migration after the seed that puts a regex list back into the database check.
 */
export interface ScannedFile {
  path: string;
  text: string;
}

const MIN_TERMS_FOR_A_COPY = 8;

/** Files that legitimately name many drugs but are NOT the controlled list. Each needs its reason. */
const NOT_THE_LIST: Record<string, string> = {
  "apps/web/src/lib/scribe/drug-names.ts": "speech-recognition vocabulary for the scribe (words to hear), not a control list",
  "packages/medicines/src/safety/drug-safety.ts": "therapeutic-class interaction patterns for the add-medicine check, not a control list",
  "packages/shared/src/proposed-config/registry.ts": "versioned keyword vocabularies (sensitive-topic words, allergy classes) that happen to name some of the same drugs, not a control list",
};

export function findSecondLists(files: readonly ScannedFile[], terms: readonly string[]): string[] {
  const patterns = terms.map((t) => ({ t, re: new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i") }));
  const hits: string[] = [];
  for (const f of files) {
    if (NOT_THE_LIST[f.path]) continue;
    const found = patterns.filter((p) => p.re.test(f.text)).length;
    // the regex form of the same words (co-?codamol) counts as co-codamol and cocodamol
    if (found >= MIN_TERMS_FOR_A_COPY) hits.push(`${f.path} (${found} controlled terms)`);
  }
  return hits;
}

function walk(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", "dist", "build", ".expo", "__pycache__", ".venv"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|mjs|py)$/.test(entry.name) && !/\.(test|spec)\.(ts|tsx|js)$/.test(entry.name) && !/(^|\/)test_[^/]*\.py$/.test(full) && entry.name !== "controlled-medicine-terms.generated.ts") {
      out.push(full);
    }
  }
}

describe("there is exactly one controlled-medicine list (repo scan)", () => {
  const terms = seed.map((t) => t.term);

  it("no source file outside the generated fallback holds a second copy of the list", () => {
    const paths: string[] = [];
    const roots = ["apps/web/src", "apps/web/scripts", "apps/console/src", "apps/mobile/src", "apps/mobile/app", "services/ml/app", "supabase/functions", "scripts"];
    for (const r of roots) walk(path.join(repoRoot, r), paths);
    for (const pkg of fs.readdirSync(path.join(repoRoot, "packages"))) walk(path.join(repoRoot, "packages", pkg, "src"), paths);
    const files = paths.map((p) => ({ path: path.relative(repoRoot, p), text: fs.readFileSync(p, "utf8") }));
    expect(files.length).toBeGreaterThan(500);
    expect(findSecondLists(files, terms)).toEqual([]);
  });

  it("the scan can fail: a planted copy of the list is found, and the unrelated vocabularies are the only exemptions", () => {
    const planted: ScannedFile = { path: "apps/web/src/lib/new-guard.ts", text: `const LIST = /\\b(${terms.slice(0, 12).join("|")})\\b/i;` };
    expect(findSecondLists([planted], terms)).toEqual(["apps/web/src/lib/new-guard.ts (12 controlled terms)"]);
    expect(findSecondLists([{ path: "apps/web/src/lib/short.ts", text: "morphine tramadol codeine" }], terms)).toEqual([]);
    for (const p of Object.keys(NOT_THE_LIST)) expect(fs.existsSync(path.join(repoRoot, p))).toBe(true);
  });

  it("the database check reads the table: the newest migration defining private.is_controlled_medicine uses controlled_medicine_terms, and no later migration holds a list", () => {
    const files = fs.readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort();
    const defining = files.filter((f) => /create (or replace )?function private\.is_controlled_medicine/.test(fs.readFileSync(path.join(migrations, f), "utf8")));
    const latest = defining[defining.length - 1];
    expect(latest >= SEED_MIGRATION).toBe(true);
    const body = fs.readFileSync(path.join(migrations, latest), "utf8");
    const fn = body.slice(body.search(/create (or replace )?function private\.is_controlled_medicine/));
    const definition = fn.slice(0, fn.indexOf("$$;", fn.indexOf("$$") + 2));
    expect(definition).toContain("public.controlled_medicine_terms");
    expect(definition).not.toMatch(/~\*\s*'\\m\(/);
    const later = files.filter((f) => f > SEED_MIGRATION && f !== SEED_MIGRATION);
    const offenders = later.filter((f) => {
      const text = fs.readFileSync(path.join(migrations, f), "utf8");
      return findSecondLists([{ path: f, text }], terms).length > 0;
    });
    expect(offenders).toEqual([]);
  });
});
