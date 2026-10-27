import test from "node:test";
import assert from "node:assert/strict";
import { diff, buildSnapshot } from "./check-policy-baseline.mjs";

const p = (id, q = "a") => ({ id, cmd: "SELECT", roles: "public", qual_md5: q, check_md5: "c" });

test("identical snapshots have no difference", () => {
  assert.deepEqual(diff([p("public.t.x")], [p("public.t.x")]), { added: [], removed: [], changed: [] });
});

test("added, removed and changed policies are each reported (sabotage: widened qual)", () => {
  const d = diff([p("public.t.new"), p("public.t.kept", "WIDER")], [p("public.t.gone"), p("public.t.kept", "a")]);
  assert.deepEqual(d, { added: ["public.t.new"], removed: ["public.t.gone"], changed: ["public.t.kept"] });
});

test("--write keeps enforce: true, defaults to false, and never enables it by itself", () => {
  const live = [p("public.t.x")];
  assert.equal(JSON.parse(buildSnapshot(live, { enforce: true, policies: [] }, "2026-10-27")).enforce, true);
  assert.equal(JSON.parse(buildSnapshot(live, { enforce: false, policies: [] }, "2026-10-27")).enforce, false);
  assert.equal(JSON.parse(buildSnapshot(live, null, "2026-10-27")).enforce, false);
  assert.deepEqual(JSON.parse(buildSnapshot(live, null, "2026-10-27")).policies, live);
});
