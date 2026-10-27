// W-40: HTTP-layer load on the clinician work queue ONLY.
//
// SCOPE: this script calls public.queue_next and nothing else. It sends NO red-event, page, reading-save or chart traffic.
// Those paths, and their safety checks, are driven by the database-layer harness in tools/load (node tools/load/run.mjs --stage A|B|C|D).
// See scripts/load/README.md for how the two fit together, how to mint the doctor sessions, and what each safety number means.
//
// Every virtual user is one is_test doctor who asks for the next task through PostgREST, the way the console does.
//
//   k6 run -e SUPABASE_URL=http://127.0.0.1:54321 -e SUPABASE_ANON_KEY=... -e TEST_SESSIONS_FILE=/abs/path/sessions.json \
//          -e STAGE=A scripts/load/k6/queue-next.js
//   (a hosted scratch project also needs -e LOAD_TEST_PROJECT_REFS=<ref>)
//
// What it measures, and what fails the run (thresholds):
//   http_req_failed / http_req_duration  error rate and p95 of queue_next (proposed targets in stages.js)
//   queue_server_errors   responses with status >= 500: must be 0. A 5xx here means an internal error reached the doctor.
//   queue_contention_409  responses that are a 409 or carry code 23505 (unique violation): must be <= CONTENTION_MAX (default 0).
//                         The unique index task_claims_one_live makes a double claim impossible at the database, so a collision shows
//                         up as this error, not as two claims. queue_next is meant to absorb that race (SKIP LOCKED); one that
//                         reaches the doctor is the signal worth seeing under load.
//   second_live_claim     a VU was handed a second, different claim while the first was still inside its lease: must be 0.
//   teardown_double_claims after the run, each doctor's live claims are read back through the API (rows with ended_at null): a doctor
//                         with two, or one task live for two doctors, counts here: must be 0.
//
// "No task claimed twice" and "no doctor with two live claims" are also checked in the database by scripts/load/verify-safety.sql, but
// the unique index makes the first of those impossible to fail, so the numbers above are the real contention measures.
//
// NOT EXECUTED when written (no k6 and no Docker on the authoring machine).

import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";
import { SharedArray } from "k6/data";
import exec from "k6/execution";
import { stage, TARGETS, assertNotProduction } from "./stages.js";

const S = stage();
const URL = __ENV.SUPABASE_URL;
const ANON = __ENV.SUPABASE_ANON_KEY;
const CONTENTION_MAX = Number(__ENV.CONTENTION_MAX || 0);
assertNotProduction(URL);

const sessions = new SharedArray("sessions", () => JSON.parse(open(__ENV.TEST_SESSIONS_FILE || "sessions.json")));

const serverErrors = new Counter("queue_server_errors");
const contention409 = new Counter("queue_contention_409");
const secondLiveClaim = new Counter("second_live_claim");
const tasksHandedOut = new Counter("tasks_handed_out");
const teardownDouble = new Counter("teardown_double_claims");

const VUS = Math.min(S.doctors, sessions.length);

export const options = {
  scenarios: {
    doctors: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: S.ramp, target: VUS },
        { duration: S.hold, target: VUS },
        { duration: "1m", target: 0 },
      ],
    },
  },
  teardownTimeout: "5m",
  thresholds: {
    http_req_failed: [`rate<${TARGETS.errorRateMax}`],
    http_req_duration: [`p(95)<${TARGETS.nextTaskP95Ms}`],
    queue_server_errors: ["count==0"],
    queue_contention_409: [`count<=${CONTENTION_MAX}`],
    second_live_claim: ["count==0"],
    teardown_double_claims: ["count==0"],
  },
};

// Each VU has its own JavaScript context in k6, so this module-level variable is per doctor: the claim this VU currently holds.
let held = null; // { claimId, taskId, expiresAtMs }

const headers = (jwt) => ({ apikey: ANON, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" });

export default function () {
  const me = sessions[(exec.vu.idInTest - 1) % sessions.length];
  const res = http.post(`${URL}/rest/v1/rpc/queue_next`, JSON.stringify({ p_types: null }), { headers: headers(me.jwt), tags: { name: "queue_next" } });

  if (res.status >= 500) serverErrors.add(1);
  let body = null;
  try {
    body = res.json();
  } catch (_) {
    body = null;
  }
  if (res.status === 409 || (body && String(body.code) === "23505")) contention409.add(1);

  const ok = check(res, { "queue_next answered 200": (r) => r.status === 200 });
  if (ok && body && body.task && body.task.id) {
    tasksHandedOut.add(1);
    const claimId = body.claim_id;
    const expiresAtMs = body.claim_expires_at ? Date.parse(body.claim_expires_at) : 0;
    // A second DIFFERENT claim while the first is still inside its lease (2 s of clock skew allowed) is a conflict.
    if (held && claimId && held.claimId !== claimId && Date.now() < held.expiresAtMs - 2000) secondLiveClaim.add(1);
    // The same doctor must also see the same task while already_claimed is true.
    if (held && body.already_claimed === true && held.taskId !== body.task.id) secondLiveClaim.add(1);
    held = { claimId, taskId: body.task.id, expiresAtMs };
  }
  sleep(60 / S.nextTaskPerDoctorPerMin);
}

// After the run: read each doctor's own live claims back through the API (row security shows a doctor their own rows).
export function teardown() {
  const byTask = {};
  const limit = Math.min(sessions.length, 300);
  for (let i = 0; i < limit; i++) {
    const r = http.get(`${URL}/rest/v1/task_claims?ended_at=is.null&select=id,task_id`, { headers: headers(sessions[i].jwt), tags: { name: "teardown_claims" } });
    if (r.status !== 200) continue;
    let rows = [];
    try {
      rows = r.json();
    } catch (_) {
      rows = [];
    }
    if (rows.length > 1) {
      teardownDouble.add(1);
      console.error(`teardown: doctor session ${i} holds ${rows.length} live claims`);
    }
    for (const row of rows) {
      if (byTask[row.task_id] !== undefined && byTask[row.task_id] !== i) {
        teardownDouble.add(1);
        console.error(`teardown: task ${row.task_id} is live for doctors ${byTask[row.task_id]} and ${i}`);
      }
      byTask[row.task_id] = i;
    }
  }
  if (sessions.length > limit) console.warn(`teardown read ${limit} of ${sessions.length} doctors; the database check in verify-safety.sql covers all`);
}
