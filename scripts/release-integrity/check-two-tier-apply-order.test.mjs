// Run with: node --test scripts/release-integrity/check-two-tier-apply-order.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkApplyOrder, parseLive } from "./check-two-tier-apply-order.mjs";

const files = ["20261012183729_live.sql", "20261013003317_a.sql", "20261013003751_b.sql"];

test("migrations after the live head are safe and listed in order", () => {
  const r = checkApplyOrder(files, ["20261012183729"]);
  assert.deepEqual(r.toApply, ["20261013003317_a.sql", "20261013003751_b.sql"]);
  assert.deepEqual(r.problems, []);
});

test("a live migration newer than one to apply is refused (sabotage: this is the case the check exists for)", () => {
  const r = checkApplyOrder(files, ["20261012183729", "20261013003500"]);
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /20261013003317_a\.sql sorts before the newest live version 20261013003500/);
});

test("duplicate versions in the repository are refused", () => {
  const r = checkApplyOrder([...files, "20261013003317_c.sql"], ["20261012183729"]);
  assert.ok(r.problems.some((p) => /duplicate versions/.test(p)));
});

test("the live list may be lines or the JSON from list_migrations", () => {
  assert.deepEqual(parseLive("20261012183729\n20261013003317_x\n"), ["20261012183729", "20261013003317"]);
  assert.deepEqual(parseLive('[{"version":"20261012183729"},"20261013003317"]'), ["20261012183729", "20261013003317"]);
  assert.deepEqual(parseLive('{"result":[{"version":"20261012183729"}]}'), ["20261012183729"]);
});
