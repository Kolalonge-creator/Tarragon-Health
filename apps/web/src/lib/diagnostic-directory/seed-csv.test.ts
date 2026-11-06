/** The Lagos and Abuja seed spreadsheet (docs/plans) must pass the same reader the admin import screen uses, row by row. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readImport } from "./import-csv";

it("the Lagos and Abuja seed reads with with every column recognised and every row sourced", () => {
  const text = readFileSync(join(__dirname, "../../../../../docs/plans/diagnostic-directory-seed-lagos-abuja-2026-11-06.csv"), "utf8");
  const r = readImport(text);
  expect(r).toMatchObject({ ok: true });
  if (!r.ok) throw new Error(r.reason);
  expect(r.ignoredHeaders).toEqual([]);
  expect(r.rows.every((row) => row.trading_name && row.branch_name && row.evidence && row.evidence_url)).toBe(true);


  expect(r.rows).toHaveLength(34);
});
