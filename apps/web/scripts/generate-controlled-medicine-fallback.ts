/**
 * Writes apps/web/src/lib/rules/controlled-medicine-terms.generated.ts, the offline fallback for the controlled-medicine guard (OQ-484).
 *
 *   pnpm --filter @tarragon/web controlled-medicine-fallback          from the seed in the migration (offline; what the test checks)
 *   pnpm --filter @tarragon/web controlled-medicine-fallback --live   from the live table, after the CMO has changed the list for good
 *                                                                     (needs `npx supabase link`; reads only the active terms)
 *
 * The list itself lives in public.controlled_medicine_terms. Nothing here is typed by hand.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseControlledMedicineList } from "../src/lib/rules/controlled-medicine-list";
import { SEED_MIGRATION, parseSeedTerms, renderFallbackFile } from "../src/lib/rules/controlled-medicine-fallback-codegen";

const root = path.resolve(__dirname, "../../..");
const target = path.resolve(__dirname, "../src/lib/rules/controlled-medicine-terms.generated.ts");

function fromMigration(): string {
  const sql = readFileSync(path.join(root, "supabase/migrations", SEED_MIGRATION), "utf8");
  const terms = parseSeedTerms(sql);
  return renderFallbackFile(terms, `the seed in supabase/migrations/${SEED_MIGRATION}`, terms.length);
}

function fromLiveTable(): string {
  const out = execFileSync("npx", ["supabase", "db", "query", "--linked", "-o", "json", "-c", "select public.get_controlled_medicine_list()::text as list"], {
    cwd: root,
    encoding: "utf8",
  });
  const json: unknown = JSON.parse(out.slice(out.indexOf("{")));
  const rows = (json as { rows?: { list?: string }[] }).rows;
  const raw = rows?.[0]?.list;
  if (!raw) throw new Error("the live table returned no list");
  const list = parseControlledMedicineList(JSON.parse(raw));
  if (!list || list.terms.length === 0) throw new Error("the live list is empty or malformed; not overwriting the fallback");
  return renderFallbackFile(list.terms, "the live table public.controlled_medicine_terms", list.version);
}

writeFileSync(target, process.argv.includes("--live") ? fromLiveTable() : fromMigration());
console.log(`wrote ${path.relative(root, target)}`);
