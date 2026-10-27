import test from "node:test";
import assert from "node:assert/strict";
import { diff } from "./check-policy-baseline.mjs";

const p = (id, q = "a") => ({ id, cmd: "SELECT", roles: "public", qual_md5: q, check_md5: "c" });

test("identical snapshots have no difference", () => {
  assert.deepEqual(diff([p("public.t.x")], [p("public.t.x")]), { added: [], removed: [], changed: [] });
});

test("added, removed and changed policies are each reported (sabotage: widened qual)", () => {
  const d = diff([p("public.t.new"), p("public.t.kept", "WIDER")], [p("public.t.gone"), p("public.t.kept", "a")]);
  assert.deepEqual(d, { added: ["public.t.new"], removed: ["public.t.gone"], changed: ["public.t.kept"] });
});
