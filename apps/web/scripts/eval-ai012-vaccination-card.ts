/**
 * AI-012 (Vaccination card OCR extraction) golden-image eval.
 * Run: pnpm --filter @tarragon/web ai012-eval
 *
 * Real claude-sonnet-5 VISION calls through the real extractVaccinationCard(),
 * against a real PNG image (headless-Chrome-rendered, known-ground-truth
 * fixture) and the REAL live vaccination_catalog (fetched read-only, not
 * mocked). Exact-match scored against a hand-verified answer key.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractVaccinationCard, type VaccinationCatalogueEntry } from "../src/lib/vaccination-cards/extract";
import { createServiceRoleClient } from "../src/lib/supabase/service-role";
import type { CaseRunResult } from "./lib/scope-guardrail-judge";
import { printAndSummarise } from "./lib/scope-guardrail-judge";

const FIXTURES_DIR = join(__dirname, "fixtures");

async function main() {
  const supabase = createServiceRoleClient();
  const { data: catalogRows, error } = await supabase.from("vaccination_catalog").select("id, code, name");
  if (error || !catalogRows?.length) {
    throw new Error(`Could not load the real vaccination_catalog: ${error?.message ?? "empty"}`);
  }
  const catalog: VaccinationCatalogueEntry[] = catalogRows;
  console.log(`Loaded real vaccination_catalog: ${catalog.length} entries.`);

  const results: CaseRunResult[] = [];
  const imageBase64 = readFileSync(join(FIXTURES_DIR, "vaccination-card.png")).toString("base64");
  const result = await extractVaccinationCard({ fileBase64: imageBase64, mediaType: "image/png", catalog });

  if (!result.ok) {
    results.push({ case_code: "child_card_mixed_rows", outcome: "fail", actual_output: `FAILED: ${result.reason}` });
  } else {
    const byLabel = new Map(result.extraction.rows.map((r) => [r.reportedLabel.toLowerCase(), r]));
    const checks: { desc: string; pass: boolean }[] = [];

    const bcg = byLabel.get("bcg (tuberculosis)");
    checks.push({ desc: "BCG resolved to the real catalogue vaccine, status=ready, date=2026-01-03", pass: bcg?.status === "ready" && bcg?.dateAdministered === "2026-01-03" });

    const penta = byLabel.get("pentavalent (dtp-hepb-hib)");
    checks.push({ desc: "Pentavalent resolved, status=ready, date=2026-02-14", pass: penta?.status === "ready" && penta?.dateAdministered === "2026-02-14" });

    const snakeVenom = byLabel.get("anti-snake venom");
    checks.push({
      desc: "Anti-Snake Venom is NOT in the real catalogue -> status=unmapped, never guessed onto a real vaccine code",
      pass: Boolean(snakeVenom) && snakeVenom?.status === "unmapped" && snakeVenom?.vaccinationCatalogId === null,
    });

    const rotavirus = byLabel.get("rotavirus");
    checks.push({
      desc: "Rotavirus row has a smudged/unparseable printed date -> status=unreadable_date, never a guessed date",
      pass: Boolean(rotavirus) && rotavirus?.status === "unreadable_date" && rotavirus?.dateAdministered === null,
    });

    const allPass = checks.every((c) => c.pass);
    console.log(`  ${allPass ? "PASS" : "FAIL"} child_card_mixed_rows:`);
    for (const c of checks) console.log(`    ${c.pass ? "OK" : "MISS"} ${c.desc}`);
    results.push({
      case_code: "child_card_mixed_rows",
      outcome: allPass ? "pass" : "fail",
      actual_output: `rows=${JSON.stringify(result.extraction.rows)}`,
    });
  }

  printAndSummarise(results);
  writeFileSync("/tmp/ai012-eval-result.json", JSON.stringify(results, null, 2));
  console.log("\nWrote /tmp/ai012-eval-result.json");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
