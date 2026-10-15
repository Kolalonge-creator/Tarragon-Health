// SR4 scenarios. Each one drives the REAL database functions and tables the way PostgREST and the edge functions do (a transaction as the
// signed-in role), and returns { summaries, assertions, notes }. The HTTP layer (Next.js, edge functions, Expo, Resend, Zoom, Paystack) is
// NOT in the loop: these are database-layer numbers. Assertions are the two safety checks of plan phase 2 plus per-scenario no-loss checks.
import crypto from "node:crypto";
import { asUser, asService, Recorder, pool as runPool, sampleConnections, sleep } from "./lib.mjs";
import { TARGETS } from "./targets.mjs";

export function makeIds(seed) {
  const id = (kind, i) => {
    const h = crypto.createHash("md5").update(`lg${seed}:${kind}:${i}`).digest("hex");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
  };
  return { member: (i) => id("m", i), free: (i) => id("f", i), doctor: (i) => id("d", i) };
}

const A = (name, ok, detail) => ({ name, ok, detail });

async function withSampler(admin, fn) {
  const stop = sampleConnections(admin, 250);
  const out = await fn();
  out.connections = await stop();
  return out;
}

async function cleanTasks(db) {
  const c = await db.connect();
  try {
    await c.query("set session_replication_role = replica");
    await c.query("delete from public.task_claims where task_id in (select id from public.clinical_tasks where patient_id in (select id from public.profiles where full_name like 'LOADGEN%'))");
    await c.query("delete from public.clinical_task_transitions where task_id in (select id from public.clinical_tasks where patient_id in (select id from public.profiles where full_name like 'LOADGEN%'))");
    await c.query("delete from public.clinical_tasks where patient_id in (select id from public.profiles where full_name like 'LOADGEN%')");
    await c.query("delete from public.pages where patient_id in (select id from public.profiles where full_name like 'LOADGEN%')");
    await c.query("delete from public.triage_events where patient_id in (select id from public.profiles where full_name like 'LOADGEN%')");
  } finally {
    await c.query("reset session_replication_role").catch(() => {});
    c.release();
  }
}

// 1. Morning logging peak: most Members log a blood pressure reading in a 3 hour window. Measured here as a compressed burst.
export async function morningLoggingPeak(ctx) {
  const { db, ids, cfg } = ctx;
  const loggers = Math.min(Math.round(cfg.members * 0.6), 30000);
  const rec = new Recorder("morning logging peak (reading save, as the patient)");
  // baseline: the same save one at a time, so queueing can be told apart from the cost of the save itself
  const base = new Recorder("baseline: reading save, one at a time");
  for (let n = 0; n < 40; n++) {
    const i = 1 + (n % cfg.members);
    await base.time(() => asUser(db, ids.member(i), (c) => c.query("insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source) values ($1, $2, 'blood_pressure', 120, 80, now(), 'manual')", [ctx.org, ids.member(i)])));
  }
  base.finish();
  const out = await withSampler(ctx.admin, async () => {
    await runPool(loggers, cfg.pool, async (n) => {
      const i = 1 + (n % cfg.members);
      await rec.time(() => asUser(db, ids.member(i), (c) =>
        c.query("insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source) values ($1, $2, 'blood_pressure', $3, $4, now(), 'manual')",
          [ctx.org, ids.member(i), 110 + (n % 30), 70 + (n % 12)])));
    });
    rec.finish();
    return { summaries: [rec.summary(), base.summary()] };
  });
  out.assertions = [
    A(`reading save p95 within ${TARGETS.readingSaveP95Ms} ms`, (out.summaries[0].p95 ?? 0) <= TARGETS.readingSaveP95Ms, `p95 ${out.summaries[0].p95?.toFixed(0)} ms`),
    A("no failed saves", out.summaries[0].errors === 0, `${out.summaries[0].errors} errors ${JSON.stringify(out.summaries[0].errorKinds)}`),
  ];
  out.notes = [`${loggers} Members logged (60 percent of ${cfg.members}${loggers < Math.round(cfg.members * 0.6) ? ", capped at 30,000" : ""}) with ${cfg.pool} requests in flight.`];
  return out;
}

// 2. Burst of red events for Members, plus the page ladder, plus a Free comparison.
export async function redBurst(ctx) {
  const { db, ids, cfg } = ctx;
  const R = Math.max(10, Math.min(Math.round(cfg.members * 0.01), 300));
  const readings = new Recorder("red burst: red reading save (Member)");
  const paging = new Recorder("red burst: create_red_page (service role)");
  const notes = [];
  await cleanTasks(db);
  // a fixture rule set that is approved, so events are not shadow (a throwaway local database; teardown removes it)
  let rs = (await db.query("select id from public.triage_rule_sets where code = 'loadgen' limit 1")).rows[0]?.id;
  if (!rs) {
    // Approval needs a chief medical officer in production. This is a throwaway local database, so the fixture row goes in with triggers off.
    const c = await db.connect();
    try {
      await c.query("set session_replication_role = replica");
      rs = (await c.query("insert into public.triage_rule_sets (code, version, status, rules, approved_by, approved_at, note) values ('loadgen', 1, 'approved', '{\"code\":\"loadgen\",\"version\":1}'::jsonb, $1, now(), 'load test fixture, local only') returning id", [ctx.admin_id])).rows[0].id;
    } finally {
      await c.query("reset session_replication_role").catch(() => {});
      c.release();
    }
  }
  const eligible = (await db.query("select private.clinician_is_eligible($1) e", [ids.doctor(1)])).rows[0].e;
  const eventIds = [];
  const out = await withSampler(ctx.admin, async () => {
    // (a) the red readings as the patient
    await runPool(R, cfg.pool, async (n) => {
      const i = 1 + ((n * 7) % cfg.members);
      await readings.time(() => asUser(db, ids.member(i), (c) =>
        c.query("insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source) values ($1, $2, 'blood_pressure', 195, 125, now(), 'manual')", [ctx.org, ids.member(i)])));
    });
    readings.finish();
    // (b) what process-events does after grading: a red, non-shadow triage event, then create_red_page as the service role
    const evs = [];
    for (let n = 0; n < R; n++) {
      const i = 1 + ((n * 7) % cfg.members);
      const r = await db.query("insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id, rule_set_code, rule_set_version, rule_set_status, actions, shadow, is_test, basis) values ($1, $2, 'observation', gen_random_uuid(), 'red', 'R1', $3, 'loadgen', 1, 'approved', '[{\"kind\":\"page_on_call\"}]'::jsonb, false, true, gen_random_uuid()::text) returning id", [ctx.org, ids.member(i), rs]);
      evs.push(r.rows[0].id);
    }
    eventIds.push(...evs);
    await runPool(R, cfg.pool, async (n) => {
      await paging.time(() => asService(db, (c) => c.query("select public.create_red_page($1)", [evs[n]])));
    });
    paging.finish();
    return { summaries: [readings.summary(), paging.summary()] };
  });
  // assertions: nothing unpaged, each page notified the primary on push, in-app and email at critical priority
  const unpaged = (await db.query("select count(*)::int n from unnest($1::uuid[]) e(id) where not exists (select 1 from public.pages p where p.triage_event_id = e.id and p.parent_page_id is null)", [eventIds])).rows[0].n;
  const notif = (await db.query("select count(*)::int n, count(distinct channel)::int ch from public.notifications where source_table = 'pages' and source_id in (select id from public.pages where triage_event_id = any($1::uuid[])) and priority = 'critical'", [eventIds])).rows[0];
  // ladder timings: age the roots past 5 minutes, sweep; then past 10, sweep. Time each sweep under the same database.
  const age = async (mins) => db.query("begin; select set_config('tarragon.paging_write','on',true); update public.pages set sent_at = now() - make_interval(mins => " + Number(mins) + ") where triage_event_id = any('{" + eventIds.join(",") + "}'::uuid[]) and parent_page_id is null; commit;");
  await age(6);
  let t = performance.now();
  await asService(db, (c) => c.query("select private.sweep_pages()")).catch(async () => db.query("select private.sweep_pages()"));
  const sweep1 = performance.now() - t;
  const backups = (await db.query("select count(*)::int n from public.pages where parent_page_id in (select id from public.pages where triage_event_id = any($1::uuid[]) and parent_page_id is null) and role = 'backup'", [eventIds])).rows[0].n;
  const tasks1 = (await db.query("select count(*)::int n from public.clinical_tasks where type = 'red_event_unacknowledged' and patient_id in (select patient_id from public.pages where triage_event_id = any($1::uuid[]))", [eventIds])).rows[0].n;
  await age(11);
  t = performance.now();
  await db.query("select private.sweep_pages()");
  const sweep2 = performance.now() - t;
  const leads = (await db.query("select count(*)::int n from public.pages where triage_event_id = any($1::uuid[]) and parent_page_id is null and lead_alerted_at is not null", [eventIds])).rows[0].n;
  // Free comparison: a red reading from a Free user must save; count what the database triggers raise for Free versus Member
  const free = new Recorder("red burst: red reading save (Free user)");
  const fN = Math.min(R, cfg.members * cfg.freePerMember);
  const before = (await db.query("select (select count(*) from public.emergency_events) e, (select count(*) from public.clinician_alerts) a")).rows[0];
  await runPool(fN, cfg.pool, async (n) => {
    await free.time(() => asUser(db, ids.free(1 + n), (c) => c.query("insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source) values ($1, $2, 'blood_pressure', 195, 125, now(), 'manual')", [ctx.org, ids.free(1 + n)])));
  });
  free.finish();
  const after = (await db.query("select (select count(*) from public.emergency_events) e, (select count(*) from public.clinician_alerts) a")).rows[0];
  out.summaries.push(free.summary());
  const firstPage = paging.summary();
  out.pageLadder = { createRedPageP50: firstPage.p50, createRedPageP95: firstPage.p95, sweepAt6MinutesMs: sweep1, sweepAt11MinutesMs: sweep2, backupPagesCreated: backups, class1TasksCreated: tasks1, leadsAlerted: leads, roots: R };
  out.assertions = [
    A("SAFETY: no Member red event goes unpaged", unpaged === 0, `${unpaged} of ${R} events had no page`),
    A("each page notified the primary on push, in-app and email at critical priority", notif.n >= R * 3 && notif.ch >= 3, `${notif.n} critical notices over ${notif.ch} channels for ${R} pages`),
    A("the primary was an eligible, on-call clinician", eligible === true, `clinician_is_eligible = ${eligible}`),
    A(`page created within ${TARGETS.pageToOnCallSeconds} s (p95)`, (firstPage.p95 ?? 0) <= TARGETS.pageToOnCallSeconds * 1000, `p95 ${firstPage.p95?.toFixed(0)} ms (database step only)`),
    A("ladder step 1 (5 min): every unacknowledged page paged its backup and created the class 1 task", backups === R && tasks1 >= R, `${backups} backups, ${tasks1} tasks for ${R} pages`),
    A("ladder step 2 (10 min): every unacknowledged page alerted the clinical lead", leads === R, `${leads} of ${R}`),
    A("no failed reading saves", readings.summary().errors === 0 && free.summary().errors === 0, `${readings.summary().errors} Member, ${free.summary().errors} Free`),
  ];
  notes.push(`${R} simultaneous red events. Trigger side effects of the Free reds: ${after.e - before.e} emergency_events and ${after.a - before.a} clinician_alerts (the Free-plan rule is enforced by the edge-function handler, which is not part of this run).`);
  notes.push("Grading is done by the TypeScript triage engine inside process-events in production. This run inserts the red triage event directly (what the handler does after grading) and times create_red_page, the sweep and the notice rows. Delivery of push, email and SMS is not exercised.");
  out.notes = notes;
  return out;
}

// 3. Many doctors press Next task at once. The race itself is also proven with 50 raw sessions by the written shell test (run separately).
export async function queueClaims(ctx) {
  const { db, ids, cfg } = ctx;
  await cleanTasks(db);
  const D = cfg.doctors;
  const T = Math.max(1, Math.round(D * 0.7));
  const rec = new Recorder("queue_next (doctors asking for the next task)");
  for (let n = 0; n < T; n++) {
    await db.query("select private.create_clinical_task($1, 'amber_bp_review', $2)", [ids.member(1 + n), 300 + n]);
  }
  const got = [];
  // baseline: five doctors asking one at a time, each with a task waiting, to separate the cost of the call from queueing
  const base = new Recorder("baseline: queue_next, one at a time");
  const baseDocs = Math.min(5, D);
  for (let n = 0; n < baseDocs; n++) await db.query("select private.create_clinical_task($1, 'amber_bp_review', $2)", [ids.member(1 + T + n), 400 + n]);
  for (let n = 0; n < baseDocs; n++) {
    const r = await base.time(() => asUser(db, ids.doctor(D - n), (c) => c.query("select public.queue_next(null) j")));
    if (r) got.push({ doc: D - n, task: r.rows[0].j?.task?.id ?? null });
  }
  base.finish();
  const callers = D - baseDocs;
  const out = await withSampler(ctx.admin, async () => {
    await Promise.all(Array.from({ length: callers }, (_, n) => (async () => {
      const r = await rec.time(() => asUser(db, ids.doctor(1 + n), (c) => c.query("select public.queue_next(null) j")));
      if (r) got.push({ doc: n, task: r.rows[0].j?.task?.id ?? null });
    })()));
    rec.finish();
    return { summaries: [rec.summary(), base.summary()] };
  });
  const claimed = got.filter((g) => g.task);
  const distinct = new Set(claimed.map((g) => g.task)).size;
  const dupLive = (await db.query("select count(*)::int n from (select task_id from public.task_claims where ended_at is null group by 1 having count(*) > 1) x")).rows[0].n;
  const dblDoc = (await db.query("select count(*)::int n from (select clinician_id from public.task_claims where ended_at is null group by 1 having count(*) > 1) x")).rows[0].n;
  const open = (await db.query("select count(*)::int n from public.clinical_tasks where state = 'open' and patient_id in (select id from public.profiles where full_name like 'LOADGEN%')")).rows[0].n;
  out.assertions = [
    A("SAFETY: no task was claimed twice", claimed.length === distinct && dupLive === 0, `${claimed.length} claims, ${distinct} distinct tasks, ${dupLive} tasks with two live claims`),
    A("no doctor holds two live claims", dblDoc === 0, `${dblDoc} doctors`),
    A("every task was handed out when there were enough doctors", claimed.length === Math.min(T + baseDocs, D) && open === T + baseDocs - claimed.length, `${claimed.length} claimed of ${T + baseDocs} tasks by ${D} doctors, ${open} left open`),
    A(`next task p95 within ${TARGETS.nextTaskP95Ms} ms`, (out.summaries[0].p95 ?? 0) <= TARGETS.nextTaskP95Ms, `p95 ${out.summaries[0].p95?.toFixed(0)} ms`),
    A("no errors", out.summaries[0].errors === 0, `${out.summaries[0].errors} ${JSON.stringify(out.summaries[0].errorKinds)}`),
  ];
  out.notes = [`${callers} doctors asked at once for ${T} open tasks (after ${baseDocs} one-at-a-time baseline claims), through a pool of ${cfg.pool} connections (so some waited for a connection, as they would behind PostgREST).`];
  await cleanTasks(db);
  return out;
}

// 4. Booking and join calls. The daily volume of the plan (4,800 a day at Stage D) is spread over a working day; the test fires a day's worth in a burst.
export async function bookingAndJoin(ctx) {
  const { db, ids, cfg } = ctx;
  const calls = Math.min(Math.round((cfg.members / 100000) * 4800), 4800);
  const total = Math.max(calls, 200);
  const slots = new Recorder("booking: list_bookable_consult_slots");
  const join = new Recorder("join: encounter lookup (my_upcoming_encounters)");
  const from = new Date(Date.now() + 3600e3).toISOString();
  const to = new Date(Date.now() + 3 * 86400e3).toISOString();
  const out = await withSampler(ctx.admin, async () => {
    await runPool(total, cfg.pool, async (n) => {
      const i = 1 + (n % cfg.members);
      if (n % 2 === 0) await slots.time(() => asUser(db, ids.member(i), (c) => c.query("select * from public.list_bookable_consult_slots($1::timestamptz, $2::timestamptz, null, null, null)", [from, to])));
      else await join.time(() => asUser(db, ids.member(i), (c) => c.query("select * from public.my_upcoming_encounters()")));
    });
    slots.finish(); join.finish();
    return { summaries: [slots.summary(), join.summary()] };
  });
  out.assertions = [
    A("no errors", out.summaries.every((s) => s.errors === 0), JSON.stringify(out.summaries.map((s) => [s.errors, s.errorKinds]))),
    A("booking read p95 within 3 s", (out.summaries[0].p95 ?? 0) <= 3000, `p95 ${out.summaries[0].p95?.toFixed(0)} ms`),
  ];
  out.notes = [`${total} read calls (half slot listings, half upcoming-encounter lookups). Holding and confirming a slot, and the Zoom room, are behind the clinical_operations_enabled go-live guard and Zoom; they are NOT exercised here, so this measures the read side only.`];
  return out;
}

// 5. Paystack webhook storm: bursts of events, a fifth of them redeliveries of an event already seen.
export async function paystackStorm(ctx) {
  const { db, cfg } = ctx;
  const unique = Math.max(100, Math.min(Math.round(cfg.members * 0.2), 5000));
  const sends = Math.round(unique * 1.25);
  const rec = new Recorder("payment webhook insert (idempotent, service role)");
  const tag = crypto.randomUUID().slice(0, 8);
  const out = await withSampler(ctx.admin, async () => {
    await runPool(sends, cfg.pool, async (n) => {
      const k = n < unique ? n : Math.floor(Math.random() * unique);
      await rec.time(() => asService(db, async (c) => {
        const r = await c.query("insert into public.payment_transactions (provider, provider_event_id, event_type, amount_minor, currency, raw_payload) values ('paystack', $1, 'other', 12000000, 'NGN', '{}'::jsonb) on conflict (provider, provider_event_id) do nothing returning id", [`lg-${tag}-${k}`]);
        if (r.rowCount) await c.query("update public.payment_transactions set processed_at = now() where id = $1", [r.rows[0].id]);
      }));
    });
    rec.finish();
    return { summaries: [rec.summary()] };
  });
  const have = (await db.query("select count(*)::int n, count(*) filter (where processed_at is null)::int unprocessed from public.payment_transactions where provider_event_id like $1", [`lg-${tag}-%`])).rows[0];
  out.assertions = [
    A("no lost payment event and no duplicate", have.n === unique, `${have.n} stored for ${unique} unique events sent (${sends} deliveries)`),
    A("none left unprocessed", have.unprocessed === 0, `${have.unprocessed}`),
    A("no errors", out.summaries[0].errors === 0, `${out.summaries[0].errors}`),
  ];
  out.notes = [`${sends} deliveries of ${unique} distinct events. The business logic after the insert (activating a membership, ledger posting) is in the edge function and is not exercised.`];
  await db.query("delete from public.payment_transactions where provider_event_id like $1", [`lg-${tag}-%`]);
  return out;
}

// 6. Notification fan-out: one campaign or rule change queues a notice for every Member; workers drain it in batches of 50.
export async function notificationFanout(ctx) {
  const { db, cfg } = ctx;
  const N = Math.min(cfg.members, 20000);
  const workers = 4;
  await db.query("delete from public.notifications where status = 'pending' and template = 'loadgen_fanout'");
  const t0 = Date.now();
  await db.query(`insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class, priority)
    select $1, p.id, 'push', 'pending', 'loadgen_fanout', '{}', 'non_clinical', 'routine' from (select id from public.profiles where full_name like 'LOADGEN member %' limit $2) p`, [ctx.org, N]);
  const insertMs = Date.now() - t0;
  const batches = new Recorder("notification worker batch (claim 50 pending, mark sent)");
  const ages = [];
  const out = await withSampler(ctx.admin, async () => {
    const start = Date.now();
    await Promise.all(Array.from({ length: workers }, () => (async () => {
      for (;;) {
        const r = await batches.time(() => db.query(`with b as (select id from public.notifications where status = 'pending' and template = 'loadgen_fanout' order by created_at limit 50 for update skip locked)
          update public.notifications n set status = 'sent', sent_at = now(), attempts = attempts + 1 from b where n.id = b.id returning extract(epoch from now() - n.created_at) age`));
        if (!r || r.rowCount === 0) return;
        for (const row of r.rows) ages.push(Number(row.age));
      }
    })()));
    batches.finish();
    const secs = (Date.now() - start) / 1000;
    return { summaries: [batches.summary()], drain: { notices: N, seconds: secs, noticesPerSecond: N / secs } };
  });
  ages.sort((a, b) => a - b);
  const left = (await db.query("select count(*)::int n from public.notifications where status = 'pending' and template = 'loadgen_fanout'")).rows[0].n;
  out.queueAge = { p50Seconds: ages[Math.floor(ages.length * 0.5)] ?? null, p95Seconds: ages[Math.floor(ages.length * 0.95)] ?? null, maxSeconds: ages[ages.length - 1] ?? null, insertMs };
  out.assertions = [
    A("every queued notice was drained", left === 0 && ages.length === N, `${ages.length} of ${N} sent, ${left} left`),
    A("no errors", out.summaries[0].errors === 0, `${out.summaries[0].errors}`),
  ];
  out.notes = [`${N} notices, ${workers} concurrent workers. This is the database side of the worker only. Real throughput is bounded by Expo push and Resend rate limits and by the edge function's per-row work, which are not in the loop.`];
  await db.query("delete from public.notifications where template = 'loadgen_fanout'");
  return out;
}

// 7. Offline-sync flood: many phones reconnect and send their queued readings; a tenth are retries of readings already stored.
export async function offlineSyncFlood(ctx) {
  const { db, ids, cfg } = ctx;
  const devices = Math.max(20, Math.min(Math.round(cfg.members * 0.2), 2000));
  const per = 20;
  const total = Math.min(devices * per, 40000);
  const rec = new Recorder("offline sync: queued reading insert (with client_reading_id)");
  const dedupe = { deduped: 0 };
  const sentIds = [];
  const tag = crypto.randomUUID();
  const readingId = (n) => crypto.createHash("md5").update(`${tag}:${n}`).digest("hex").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, "$1-$2-$3-$4-$5");
  const sendOne = async (n, isRetry) => {
    // a retry re-sends an earlier reading from the same phone (same patient, same client_reading_id)
    const k = isRetry ? Math.floor(Math.random() * total) : n;
    const dev = k % devices;
    const i = 1 + (dev % cfg.members);
    const cid = readingId(k);
    await rec.time(async () => {
      try {
        await asUser(db, ids.member(i), (c) => c.query("insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source, client_reading_id) values ($1, $2, 'blood_pressure', 120, 80, now() - ($3 || ' minutes')::interval, 'manual', $4)",
          [ctx.org, ids.member(i), String(5 + (k % 600)), cid]));
        if (!isRetry) sentIds.push(cid);
      } catch (e) {
        if (e.code === "23505") { dedupe.deduped++; return; }
        throw e;
      }
    });
  };
  const out = await withSampler(ctx.admin, async () => {
    await runPool(total, cfg.pool, (n) => sendOne(n, false));
    await runPool(Math.round(total * 0.1), cfg.pool, (n) => sendOne(n, true));
    rec.finish();
    return { summaries: [rec.summary()] };
  });
  const stored = (await db.query("select count(distinct client_reading_id)::int n from public.vitals_readings where client_reading_id = any($1::uuid[])", [sentIds])).rows[0].n;
  out.assertions = [
    A("no reading lost: every queued reading is stored once", stored === sentIds.length, `${stored} stored of ${sentIds.length} sent`),
    A("retries were deduplicated, not errors", out.summaries[0].errors === 0 && dedupe.deduped > 0, `${dedupe.deduped} retries deduped, ${out.summaries[0].errors} errors ${JSON.stringify(out.summaries[0].errorKinds)}`),
  ];
  out.notes = [`${devices} phones, ${per} queued readings each (capped at 40,000 requests), then 10 percent re-sent.`];
  return out;
}

// 8. What the monitoring itself costs: the alert evaluator and the operations wall, on this population.
export async function monitoringCost(ctx) {
  const { db, ids, cfg } = ctx;
  const evalRec = new Recorder("alert evaluator (all enabled rules, forced)");
  const wallRec = new Recorder("operations_wall() as an admin");
  const admin = ctx.admin_id;
  for (let k = 0; k < 8; k++) await evalRec.time(() => db.query("select private.ops_evaluate_alerts(true, true)"));
  evalRec.finish();
  for (let k = 0; k < 30; k++) await wallRec.time(() => asUser(db, admin, (c) => c.query("select public.operations_wall()")));
  wallRec.finish();
  const perRule = (await db.query("select code, last_error from public.ops_alert_rules where last_error is not null")).rows;
  const out = { summaries: [evalRec.summary(), wallRec.summary()], connections: null };
  out.assertions = [
    A("evaluator runs every enabled rule without error", perRule.length === 0 && evalRec.summary().errors === 0, perRule.map((r) => `${r.code}: ${r.last_error}`).join("; ") || "ok"),
    A("the wall loads in under 2 s (p95)", (wallRec.summary().p95 ?? 0) <= 2000, `p95 ${wallRec.summary().p95?.toFixed(0)} ms`),
    A("the evaluator finishes well inside its one minute cycle", (evalRec.summary().p95 ?? 0) < 20000, `p95 ${evalRec.summary().p95?.toFixed(0)} ms`),
  ];
  out.notes = ["The stale-cron rule reads cron.job_run_details, the largest object in production (162 MB on 2026-10-10). Here it holds only this local stack's own history, so its cost is understated until SR2's clean-up lands."];
  return out;
}

export const SCENARIOS = {
  morning: morningLoggingPeak,
  red: redBurst,
  queue: queueClaims,
  booking: bookingAndJoin,
  paystack: paystackStorm,
  fanout: notificationFanout,
  offline: offlineSyncFlood,
  monitoring: monitoringCost,
};
export { sleep };
