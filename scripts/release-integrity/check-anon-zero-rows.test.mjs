import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, PUBLIC_BY_DESIGN, QUERY } from "./check-anon-zero-rows.mjs";

test("zero rows everywhere passes", () => {
  assert.deepEqual(evaluate([{ table_name: "public.profiles", row_count: 0 }]), { leaks: [], scanned: 1 });
});

test("a readable table that is not public by design is a leak (sabotage: a patient table)", () => {
  const { leaks } = evaluate([
    { table_name: "public.vitals_readings", row_count: "3" },
    { table_name: "public.marketing_resources", row_count: "9" },
  ]);
  assert.deepEqual(leaks, ["public.vitals_readings"]);
});

test("every public-by-design table is exempt, and nothing else is", () => {
  for (const t of PUBLIC_BY_DESIGN) assert.deepEqual(evaluate([{ table_name: t, row_count: 5 }]).leaks, []);
  assert.equal(PUBLIC_BY_DESIGN.size, 6);
});

test("the query is read-only: it rolls back and returns counts only", () => {
  assert.match(QUERY, /rollback;\s*$/);
  assert.doesNotMatch(QUERY, /select \*|insert |update |delete /i);
});
