// W-40: HTTP-layer load on the clinician work queue. Every virtual user is one is_test doctor who calls public.queue_next
// through PostgREST, the way the console does, and is handed the next task.
//
// Needs a disposable target (local stack, branch or scratch project) populated by tools/load/generate.mjs plus a file of
// doctor sessions: TEST_SESSIONS_FILE, a JSON array of {"jwt": "<access token of an is_test doctor>"}. Minting those tokens is an
// operator step (the DB-layer harness impersonates users in SQL and never creates real logins).
//
//   k6 run -e SUPABASE_URL=https://<scratch>.supabase.co -e SUPABASE_ANON_KEY=... \
//          -e TEST_SESSIONS_FILE=sessions.json -e STAGE=A scripts/load/k6/queue-next.js
//
// Safety checks, in two places:
//   1. here: an HTTP failure rate and p95 latency threshold, and a counter of responses that hand back a task
//      the same doctor already holds as a *different* claim (should never happen).
//   2. after the run: scripts/load/verify-safety.sql must pass. "No task claimed twice" is a database fact across all
//      virtual users, which one VU cannot see, so the database is the judge.
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
assertNotProduction(URL);

const sessions = new SharedArray("sessions", () => JSON.parse(open(__ENV.TEST_SESSIONS_FILE || "sessions.json")));

const conflictingClaims = new Counter("claim_conflicts");
const tasksHandedOut = new Counter("tasks_handed_out");

export const options = {
  scenarios: {
    doctors: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: S.ramp, target: Math.min(S.doctors, sessions.length) },
        { duration: S.hold, target: Math.min(S.doctors, sessions.length) },
        { duration: "1m", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: [`rate<${TARGETS.errorRateMax}`],
    http_req_duration: [`p(95)<${TARGETS.nextTaskP95Ms}`],
    claim_conflicts: ["count==0"],
  },
};

const heldByVu = {};

export default function () {
  const me = sessions[(exec.vu.idInTest - 1) % sessions.length];
  const res = http.post(`${URL}/rest/v1/rpc/queue_next`, JSON.stringify({ p_types: null }), {
    headers: { apikey: ANON, Authorization: `Bearer ${me.jwt}`, "Content-Type": "application/json" },
    tags: { name: "queue_next" },
  });
  const ok = check(res, { "queue_next answered 200": (r) => r.status === 200 });
  if (ok) {
    const body = res.json();
    const taskId = body && (body.task_id || (body.task && body.task.id));
    if (taskId) {
      tasksHandedOut.add(1);
      const prev = heldByVu[exec.vu.idInTest];
      // queue_next says already_claimed when the doctor still holds a live claim; it must then return that same task,
      // never a different one (the response field names are read from the migration and not checked against a live run)
      if (prev && body.already_claimed === true && prev !== taskId) conflictingClaims.add(1);
      heldByVu[exec.vu.idInTest] = taskId;
    }
  }
  sleep(60 / S.nextTaskPerDoctorPerMin);
}
