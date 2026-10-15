import test from "node:test";
import assert from "node:assert/strict";
import { runWithRetry, isLoginRoleFailure } from "./retry-sync.mjs";

const quiet = { sleep: () => {}, log: () => {} };

test("returns the first success without retrying", () => {
  let n = 0;
  assert.equal(runWithRetry(() => (++n, "ok"), quiet), "ok");
  assert.equal(n, 1);
});

test("retries transient failures and then succeeds", () => {
  let n = 0;
  const out = runWithRetry(() => { if (++n < 4) throw new Error("unexpected login role status 544"); return "ok"; }, quiet);
  assert.equal(out, "ok");
  assert.equal(n, 4);
});

test("throws the last error after the attempts are used", () => {
  let n = 0;
  assert.throws(() => runWithRetry(() => { throw new Error(`Connection terminated ${++n}`); }, { ...quiet, attempts: 3 }), /terminated 3/);
  assert.equal(n, 3);
});

test("a non-transient error fails at once", () => {
  let n = 0;
  assert.throws(() => runWithRetry(() => { ++n; throw new Error("syntax error at or near select"); }, quiet), /syntax error/);
  assert.equal(n, 1);
});

test("a write-style retry repeats only the login-role failure", () => {
  let n = 0;
  const out = runWithRetry(() => { if (++n < 3) throw new Error("Failed to create login role: Connection terminated"); return "ok"; }, { ...quiet, isRetryable: isLoginRoleFailure });
  assert.equal(out, "ok");
  assert.equal(n, 3);
  let m = 0;
  assert.throws(() => runWithRetry(() => { ++m; throw new Error("Connection terminated unexpectedly"); }, { ...quiet, isRetryable: isLoginRoleFailure }), /Connection terminated/);
  assert.equal(m, 1);
});
