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
    const before = await loadControlledMedicineList({ rpc: async () => ({ data: { version: 1, terms: [{ term: "other", tier: "restricted", label: "Other" }] }, error: null }) } as never);
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

  it("an empty database list is treated as a failure (the database never allows it), so the guard never reads 'nothing is controlled'", async () => {
    expect(parseControlledMedicineList({ version: 3, terms: [] })).toBeNull();
    const list = await loadControlledMedicineList({ rpc: async () => ({ data: { version: 3, terms: [] }, error: null }) } as never);
    expect(list.source).toBe("fallback");
  });

  it("says so in the log when it falls back", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    await loadControlledMedicineList({ rpc: async () => ({ data: null, error: { message: "down" } }) } as never);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("generated fallback"));
    warn.mockRestore();
  });
});

describe("the generated fallback is generated from the migration seed, not typed", () => {
  const file = fs.readFileSync(path.join(__dirname, "controlled-medicine-terms.generated.ts"), "utf8");
  // `--live` regenerates it from the table after the CMO has changed the list; otherwise it must be exactly what the generator writes from the seed
  const fromLive = file.includes("from the live table public.controlled_medicine_terms.");

  it("is byte-for-byte what the generator writes from the seed, or (after `--live`) a well-formed render of the live table", () => {
    if (!fromLive) {
      expect(file).toBe(renderFallbackFile(seed, `the seed in supabase/migrations/${SEED_MIGRATION}`, seed.length));
    } else {
      expect(file).toBe(renderFallbackFile(CONTROLLED_MEDICINE_FALLBACK, "the live table public.controlled_medicine_terms", CONTROLLED_MEDICINE_FALLBACK_VERSION));
      expect(CONTROLLED_MEDICINE_FALLBACK_VERSION).toBeGreaterThanOrEqual(seed.length);
      expect(CONTROLLED_MEDICINE_FALLBACK.length).toBeGreaterThan(0);
    }
  });

  it("has the 60 seeded terms at the seed version (until it is refreshed from the live table), and the fallback list is built from them", () => {
    expect(seed).toHaveLength(60);
    expect(fallbackControlledMedicineList().terms).toBe(CONTROLLED_MEDICINE_FALLBACK);
    if (!fromLive) {
      expect(CONTROLLED_MEDICINE_FALLBACK_VERSION).toBe(60);
      expect(new Set(CONTROLLED_MEDICINE_FALLBACK.map((t) => t.term))).toEqual(new Set(seed.map((t) => t.term)));
    }
  });

  it("every term in the fallback is flagged by the guard with its own tier and label", () => {
    for (const t of CONTROLLED_MEDICINE_FALLBACK) {
      expect({ term: t.term, hit: matchControlledMedicineTerm(fallbackControlledMedicineList(), t.term) }).toEqual({ term: t.term, hit: t });
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

const MIN_TERMS_FOR_A_COPY = 6;

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

/** The text of each call's argument list, to the matching close bracket. */
function callArguments(text: string, callee: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf(`${callee}(`, from);
    if (at < 0) return out;
    let depth = 0;
    let i = at + callee.length;
    for (; i < text.length; i++) {
      if (text[i] === "(" || text[i] === "{" || text[i] === "[") depth++;
      else if (text[i] === ")" || text[i] === "}" || text[i] === "]") {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push(text.slice(at + callee.length + 1, i));
    from = i;
  }
}

/** True when the argument list has a comma outside any nested brackets (a second argument). */
function hasSecondArgument(args: string): boolean {
  let depth = 0;
  for (const ch of args) {
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") depth--;
    else if (ch === "," && depth === 0) return true;
  }
  return false;
}

describe("every guard call passes the database list (a forgotten argument would quietly use the stale fallback)", () => {
  const webSrc = path.join(repoRoot, "apps/web/src");
  const sources: string[] = [];
  walk(webSrc, sources);

  it("controlledSubstanceInfo is always given a list outside its own file", () => {
    const calls = sources
      .filter((p) => !p.endsWith(path.join("rules", "controlled-substances.ts")))
      .flatMap((p) => callArguments(fs.readFileSync(p, "utf8"), "controlledSubstanceInfo").map((args) => ({ file: path.relative(repoRoot, p), args })));
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.filter((c) => !hasSecondArgument(c.args))).toEqual([]);
  });

  it("every buildPrescriptionPdfData call in the loaders passes controlledList", () => {
    const file = path.join(webSrc, "lib/prescriptions/load-prescription-pdf-data.ts");
    const calls = callArguments(fs.readFileSync(file, "utf8"), "buildPrescriptionPdfData");
    expect(calls).toHaveLength(3);
    expect(calls.filter((c) => !c.includes("controlledList"))).toEqual([]);
  });

  it("the call-site check can fail", () => {
    expect(hasSecondArgument(callArguments("x = controlledSubstanceInfo(name);", "controlledSubstanceInfo")[0])).toBe(false);
    expect(hasSecondArgument(callArguments("controlledSubstanceInfo(foo(a, b))", "controlledSubstanceInfo")[0])).toBe(false);
    expect(hasSecondArgument(callArguments("controlledSubstanceInfo(foo(a, b), list)", "controlledSubstanceInfo")[0])).toBe(true);
  });
});
