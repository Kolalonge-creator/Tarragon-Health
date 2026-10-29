import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, extractRows, QUERY_JSON, PUBLIC_BY_DESIGN, KNOWN_REPORTED, POSITIVE_CONTROL, QUERY } from "./check-anon-zero-rows.mjs";

const rel = (schema_name, rel_name, o = {}) => ({ schema_name, rel_name, kind: "r", rls_enabled: true, status: "ok", row_count: 0, err: null, ...o });
const control = rel("public", "consent_versions", { row_count: 1 });

test("zero rows everywhere with a passing control is clean", () => {
  const r = evaluate([control, rel("public", "profiles", { status: "denied" })]);
  assert.deepEqual([r.leaks, r.rlsOpen, r.errors], [[], [], []]);
  assert.equal(r.controlOk, true);
});

test("a readable table that is not public by design is a leak (sabotage: a patient table)", () => {
  const r = evaluate([control, rel("public", "vitals_readings", { row_count: "3" }), rel("public", "marketing_resources", { row_count: 9 })]);
  assert.deepEqual(r.leaks, ["public.vitals_readings"]);
});

test("a missing or empty positive control is not a pass (sabotage: the scan never ran as anon)", () => {
  assert.equal(evaluate([rel("public", "profiles")]).controlOk, false);
  assert.equal(evaluate([rel("public", "consent_versions", { row_count: 0 })]).controlOk, false);
  assert.equal(evaluate([rel("public", "consent_versions", { status: "denied", row_count: 0 })]).controlOk, false);
  assert.equal(evaluate([]).controlOk, false);
});

test("an error other than permission denied is surfaced, not read as zero rows", () => {
  const r = evaluate([control, rel("public", "x", { status: "error", row_count: null, err: "XX000: role switch to anon did not take effect" })]);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /role switch/);
});

test("a table with row security off that anon can open is flagged even with zero rows; a denied one is not", () => {
  const r = evaluate([control, rel("public", "t_open", { rls_enabled: false }), rel("public", "t_closed", { rls_enabled: false, status: "denied" })]);
  assert.deepEqual(r.rlsOpen, ["public.t_open"]);
});

test("views anon can read are reported, and a view with rows is a leak", () => {
  const r = evaluate([control, rel("public", "v_secret", { kind: "v", row_count: 2 }), rel("public", "v_empty", { kind: "v" })]);
  assert.deepEqual(r.leaks, ["public.v_secret"]);
  assert.equal(r.views.length, 2);
});

test("known reported findings and storage never fail; storage buckets are listed", () => {
  const r = evaluate([
    control,
    rel("net", "_http_response", { rls_enabled: false, row_count: 40 }),
    rel("storage", "objects", { row_count: 5 }),
    { schema_name: "storage", rel_name: "bucket:patient-avatars", kind: "bucket", rls_enabled: true, status: "ok", row_count: 1, err: null },
  ]);
  assert.deepEqual([r.leaks, r.rlsOpen], [[], []]);
  assert.equal(r.reported.length, 1);
  assert.deepEqual(r.buckets, ["patient-avatars"]);
});

test("every public-by-design table is exempt, the control is one of them, and nothing else is", () => {
  assert.equal(PUBLIC_BY_DESIGN.size, 6);
  assert.ok(PUBLIC_BY_DESIGN.has(POSITIVE_CONTROL));
  for (const t of PUBLIC_BY_DESIGN) {
    const [s, n] = t.split(".");
    assert.deepEqual(evaluate([control, rel(s, n, { row_count: 5 })]).leaks, []);
  }
  assert.ok(KNOWN_REPORTED.size > 0);
});

const sample = [
  { schema_name: "public", rel_name: "consent_versions", kind: "r", rls_enabled: true, status: "ok", row_count: 2, err: null },
  { schema_name: "public", rel_name: "profiles", kind: "r", rls_enabled: true, status: "denied", row_count: 0, err: null },
];

test("extractRows reads a flat array, a {rows} wrapper, an array of result sets, and a status blob first", () => {
  const flat = JSON.stringify(sample);
  assert.equal(extractRows(flat).length, 2);
  assert.equal(extractRows(JSON.stringify({ boundary: "x", rows: sample, warning: "w" })).length, 2);
  assert.equal(extractRows(JSON.stringify([[], sample, []])).length, 2);
  assert.equal(extractRows(`Initialising login role...\n{"status":"ok"}\n${flat}`).length, 2);
  assert.equal(extractRows("nothing here").length, 0);
});

test("extractRows is not fooled by brackets inside strings", () => {
  const tricky = [{ ...sample[0], err: 'bad ] } "quote" [ {' }];
  assert.equal(extractRows(JSON.stringify(tricky)).length, 1);
});

test("the query fails closed: 42501 only is treated as denied, the role is checked, and it rolls back with counts only", () => {
  assert.match(QUERY, /when insufficient_privilege then/);
  assert.match(QUERY, /current_user <> 'anon'/);
  assert.match(QUERY, /status := 'error'/);
  assert.doesNotMatch(QUERY, /when others then\s+reset role;\s+n := 0/);
  assert.match(QUERY, /rollback;\s*$/);
  assert.doesNotMatch(QUERY, /select \*\s+from\s+(public|auth)|insert |update |delete /i);
});

test("the local-replay variant ends in one JSON aggregate that extractRows can read", () => {
  assert.match(QUERY_JSON, /json_agg\(t\)/);
  assert.doesNotMatch(QUERY_JSON, /select schema_name, rel_name/);
  assert.match(QUERY_JSON, /rollback;\s*$/);
  // what psql -q -A -t prints for that final statement: one line holding the array
  assert.equal(extractRows(JSON.stringify(sample)).length, 2);
});

const allPublicOk = () => [...PUBLIC_BY_DESIGN].map((t) => { const [s, n] = t.split("."); return rel(s, n, { row_count: t === POSITIVE_CONTROL ? 1 : 0 }); });

test("a public-by-design table anon is refused on is broken, not safe (sabotage: the 2026-10-29 marketing_resources / public_impact_metrics 42501)", () => {
  assert.deepEqual(evaluate(allPublicOk()).brokenPublic, []);
  const rows = allPublicOk().map((r) => (r.rel_name === "marketing_resources" || r.rel_name === "public_impact_metrics" ? { ...r, status: "denied", row_count: 0 } : r));
  const r = evaluate(rows);
  assert.equal(r.brokenPublic.length, 2);
  assert.match(r.brokenPublic.join(" "), /public\.marketing_resources \(denied\)/);
  assert.match(r.brokenPublic.join(" "), /public\.public_impact_metrics \(denied\)/);
  assert.equal(r.controlOk, true);
});

test("a public-by-design table that is missing from the scan is flagged (stale allowlist or dropped table)", () => {
  const r = evaluate(allPublicOk().filter((x) => x.rel_name !== "passport_signing_keys"));
  assert.deepEqual(r.brokenPublic, ["public.passport_signing_keys (not found in the scan)"]);
});

test("a denied table that is NOT public by design stays fine", () => {
  assert.deepEqual(evaluate([...allPublicOk(), rel("public", "profiles", { status: "denied" })]).brokenPublic, []);
});
