import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, parseRows } from "./check-minor-guard-gaps.mjs";

test("an empty result passes and any row fails", () => {
  assert.deepEqual(evaluate([]), []);
  assert.deepEqual(evaluate([{ table_name: "poc_results", problem: "not in minor_dependant_table_policy" }]), [
    "poc_results (not in minor_dependant_table_policy)",
  ]);
});

test("parses both CLI output shapes, including a status blob first", () => {
  assert.deepEqual(parseRows('[{"table_name":"a","problem":"p"}]'), [{ table_name: "a", problem: "p" }]);
  assert.deepEqual(parseRows('{"a":1}\n{"boundary":"x","rows":[{"table_name":"b","problem":"q"}]}'), [{ table_name: "b", problem: "q" }]);
  assert.deepEqual(parseRows('{"rows":[]}'), []);
  assert.throws(() => parseRows("nothing"));
});
