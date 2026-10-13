// SR4 synthetic population generator. Local, disposable databases only (lib.mjs refuses anything else).
//
//   node generate.mjs --url postgresql://postgres:postgres@127.0.0.1:54397/postgres --members 500 [--seed 1] [--free-per-member 4] [--doctors N] [--teardown]
//
// Everything it writes has is_test = true (and a LOADGEN full_name), ids derive from md5(seed, kind, i) so the same seed gives the same
// population, and the bulk of it goes in with set-based INSERT ... SELECT generate_series(...) with session_replication_role = replica
// (no triggers, no FK checks) so 100,000 Members is feasible. Rows written this way skip the derived rows the triggers would create
// (risk scores, timeline entries, points); the scenarios that need trigger behaviour insert their own rows through the real path.
import { makePool, machineSpecs } from "./lib.mjs";

export function parseArgs(argv) {
  const a = { url: process.env.LOAD_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54397/postgres", members: 500, seed: 1, freePerMember: 4, doctors: null, teardown: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--url") a.url = argv[++i];
    else if (k === "--members") a.members = Number(argv[++i]);
    else if (k === "--seed") a.seed = Number(argv[++i]);
    else if (k === "--free-per-member") a.freePerMember = Number(argv[++i]);
    else if (k === "--doctors") a.doctors = Number(argv[++i]);
    else if (k === "--teardown") a.teardown = true;
  }
  for (const k of ["members", "seed", "freePerMember"]) if (!Number.isInteger(a[k]) || a[k] < 0) throw new Error(`bad --${k}`);
  return a;
}

/** Plan section 2 staffing, interpolated: doctors needed to hold the target at each stage. A harness input, not a staffing claim. */
export function doctorsFor(members) {
  if (members <= 500) return 10;
  if (members <= 5000) return 60;
  if (members <= 25000) return 150;
  return 300;
}

export async function teardown(pool) {
  const c = await pool.connect();
  try {
    await c.query("set session_replication_role = replica");
    const t = [
      "delete from public.notifications where recipient_id in (select id from public.profiles where full_name like 'LOADGEN%')",
      "delete from public.vitals_readings where patient_id in (select id from public.profiles where full_name like 'LOADGEN%')",
      "delete from public.lab_orders where patient_id in (select id from public.profiles where full_name like 'LOADGEN%')",
      "delete from public.encounters where patient_id in (select id from public.profiles where full_name like 'LOADGEN%')",
      "delete from public.patient_memberships where patient_id in (select id from public.profiles where full_name like 'LOADGEN%')",
      "delete from public.clinical_tasks where patient_id in (select id from public.profiles where full_name like 'LOADGEN%')",
      "delete from public.pages where patient_id in (select id from public.profiles where full_name like 'LOADGEN%')",
      "delete from public.task_claims where task_id in (select id from public.clinical_tasks where patient_id in (select id from public.profiles where full_name like 'LOADGEN%'))",
      "delete from public.clinical_task_transitions where task_id in (select id from public.clinical_tasks where patient_id in (select id from public.profiles where full_name like 'LOADGEN%'))",
      "delete from public.ops_alerts where is_test",
      "delete from public.domain_event_deliveries where event_id in (select id from public.domain_events where patient_id in (select id from public.profiles where full_name like 'LOADGEN%'))",
      "delete from public.domain_events where patient_id in (select id from public.profiles where full_name like 'LOADGEN%')",
      "delete from public.triage_events where patient_id in (select id from public.profiles where full_name like 'LOADGEN%')",
      "delete from public.availability_blocks where clinician_id in (select id from public.profiles where full_name like 'LOADGEN%')",
      "delete from public.on_call_rota where primary_clinician_id in (select id from public.profiles where full_name like 'LOADGEN%')",
      "delete from public.on_call_readiness where clinician_id in (select id from public.profiles where full_name like 'LOADGEN%')",
      "delete from public.clinician_competencies where clinical_staff_id in (select id from public.clinical_staff where full_name like 'LOADGEN%')",
      "delete from public.clinical_staff where full_name like 'LOADGEN%'",
      "delete from public.triage_rule_sets where code = 'loadgen'",
      "delete from auth.users where id in (select id from public.profiles where full_name like 'LOADGEN%')",
      "delete from public.profiles where full_name like 'LOADGEN%'",
    ];
    for (const q of t) await c.query(q);
  } finally {
    await c.query("reset session_replication_role").catch(() => {});
    c.release();
  }
}

export async function generate(pool, { members, seed, freePerMember, doctors }) {
  const D = doctors ?? doctorsFor(members);
  const F = members * freePerMember;
  const S = `'lg${seed}'`;
  const t0 = Date.now();
  const timings = {};
  const c = await pool.connect();
  const step = async (name, sql, params = []) => {
    const t = Date.now();
    const r = await c.query(sql, params);
    timings[name] = { ms: Date.now() - t, rows: r.rowCount };
  };
  try {
    await c.query("set statement_timeout = 0");
    await c.query("set session_replication_role = replica");
    await c.query("select setseed($1)", [(seed % 1000) / 1000]);
    const org = (await c.query("select id from public.organisations order by created_at limit 1")).rows[0].id;

    // ids: members 0..M-1, free users M..M+F-1, doctors under a separate prefix
    const idM = `md5(${S} || ':m:' || g)::uuid`;
    const idF = `md5(${S} || ':f:' || g)::uuid`;
    const idD = `md5(${S} || ':d:' || g)::uuid`;

    await step("auth.users members", `insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
      select ${idM}, 'loadgen-m-' || g || '-${seed}@example.invalid', 'x', now(), '{}', '{}' from generate_series(1, $1) g on conflict do nothing`, [members]);
    await step("auth.users free", `insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
      select ${idF}, 'loadgen-f-' || g || '-${seed}@example.invalid', 'x', now(), '{}', '{}' from generate_series(1, $1) g on conflict do nothing`, [F]);
    await step("auth.users doctors", `insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
      select ${idD}, 'loadgen-d-' || g || '-${seed}@example.invalid', 'x', now(), '{}', '{}' from generate_series(1, $1) g on conflict do nothing`, [D]);

    await step("profiles members", `insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, is_active, language)
      select ${idM}, $1, 'patient', 'LOADGEN member ' || g, '+23481' || lpad(g::text, 8, '0'), date '1960-01-01' + (random() * 15000)::int, true, true, 'en' from generate_series(1, $2) g on conflict do nothing`, [org, members]);
    await step("profiles free", `insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, is_active, language)
      select ${idF}, $1, 'patient', 'LOADGEN free ' || g, '+23482' || lpad(g::text, 8, '0'), date '1960-01-01' + (random() * 15000)::int, true, true, 'en' from generate_series(1, $2) g on conflict do nothing`, [org, F]);
    await step("profiles doctors", `insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, is_active, language)
      select ${idD}, $1, 'clinician', 'LOADGEN doctor ' || g, '+23483' || lpad(g::text, 8, '0'), date '1980-01-01', true, true, 'en' from generate_series(1, $2) g on conflict do nothing`, [org, D]);

    const admin = md5Admin(seed);
    await c.query(`insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values ($1, 'loadgen-admin-${seed}@example.invalid', 'x', now(), '{}', '{}') on conflict do nothing`, [admin]);
    await c.query(`insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, is_active, language) values ($1, $2, 'admin', 'LOADGEN admin', '+23484' || lpad('1', 8, '0'), date '1980-01-01', true, true, 'en') on conflict do nothing`, [admin, org]);

    await step("memberships", `insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, is_test)
      select $1, ${idM}, 'purchase', 'active', now() - interval '30 days', true from generate_series(1, $2) g`, [org, members]);

    await step("clinical_staff", `insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status, license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
      select $1, ${idD}, 'LOADGEN doctor ' || g, 'MDCN', 'LG-' || g || '-${seed}', true, 'active', now(), $3, 'senior_medical_officer', 'contracted', 2, true, $3, true from generate_series(1, $2) g`, [org, D, admin]);
    await step("competencies", `insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test)
      select $1, cs.id, k.code, $2, true from public.clinical_staff cs cross join (values ('hypertension'), ('on_call')) k(code) where cs.full_name like 'LOADGEN doctor %'`, [org, admin]);
    await step("availability", `insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, is_test)
      select $1, ${idD}, now() - interval '1 minute', now() + interval '10 hours', 'queue', true from generate_series(1, $2) g`, [org, D]);
    await step("on-call readiness (first 4 doctors)", `insert into public.on_call_readiness (clinician_id, checklist_version, organisation_id, items, is_test)
      select ${idD}, 1, $1, '{}', true from generate_series(1, least($2, 4)) g on conflict do nothing`, [org, D]);
    await step("on-call rota", `insert into public.on_call_rota (organisation_id, starts_at, ends_at, primary_clinician_id, backup_clinician_id, is_test)
      values ($1, now() - interval '1 hour', now() + interval '12 hours', md5(${S} || ':d:1')::uuid, md5(${S} || ':d:2')::uuid, true)`, [org]);

    // history. Readings: 30 for each Member (one a day), 5 for each Free user. About 3 percent of readings are elevated.
    await step("vitals members", `insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
      select $1, ${idM}, 'blood_pressure', case when random() < 0.03 then 150 + (random() * 20)::int else 105 + (random() * 30)::int end, 70 + (random() * 15)::int,
             now() - (d || ' days')::interval - (random() * interval '3 hours'), 'manual'
        from generate_series(1, $2) g cross join generate_series(1, 30) d`, [org, members]);
    await step("vitals free", `insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
      select $1, ${idF}, 'blood_pressure', 105 + (random() * 30)::int, 70 + (random() * 15)::int, now() - (d || ' days')::interval, 'manual'
        from generate_series(1, $2) g cross join generate_series(1, 5) d`, [org, F]);
    await step("lab_orders", `insert into public.lab_orders (organisation_id, patient_id, status, ordered_at, total_kobo)
      select $1, ${idM}, (array['ordered','sample_collected','processing','resulted','resulted','resulted'])[1 + (random() * 5)::int]::public.lab_order_status,
             now() - (random() * interval '90 days'), 4500000 from generate_series(1, $2) g`, [org, members]);
    await step("encounters (past, completed)", `insert into public.encounters (organisation_id, patient_id, clinician_id, type, status, scheduled_at, started_at, ended_at, final_media_mode, fallback_steps, policy_version, is_test)
      select $1, ${idM}, md5(${S} || ':d:' || (1 + (g % $3::int)))::uuid, 'video', 'completed', t, t, t + interval '15 minutes', case when random() < 0.08 then 'audio_only' else 'video' end, 0, 1, true
        from (select g, now() - (random() * interval '60 days') t from generate_series(1, $2) g) x`, [org, Math.floor(members * 0.3), D]);
    await step("notifications (history)", `insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, sent_at, created_at, content_class, priority)
      select $1, ${idM}, 'push', 'sent', 'vitals_reminder', '{}', t, t, 'non_clinical', 'routine'
        from generate_series(1, $2) g cross join lateral (select now() - (random() * interval '30 days') t) x cross join generate_series(1, 20) k`, [org, members]);
    await step("notifications (free)", `insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, sent_at, created_at, content_class, priority)
      select $1, ${idF}, 'in_app', 'sent', 'vitals_reminder', '{}', t, t, 'non_clinical', 'routine'
        from generate_series(1, $2) g cross join lateral (select now() - (random() * interval '30 days') t) x cross join generate_series(1, 3) k`, [org, F]);
    for (const t of ["profiles", "vitals_readings", "notifications", "lab_orders", "encounters", "clinical_tasks"]) await c.query(`analyze public.${t}`);
  } finally {
    await c.query("reset session_replication_role").catch(() => {});
    c.release();
  }
  const counts = (await pool.query(`select
      (select count(*) from public.profiles where full_name like 'LOADGEN%')::int profiles,
      (select count(*) from public.vitals_readings v join public.profiles p on p.id = v.patient_id where p.full_name like 'LOADGEN%')::int vitals,
      (select count(*) from public.notifications n join public.profiles p on p.id = n.recipient_id where p.full_name like 'LOADGEN%')::int notifications,
      (select count(*) from public.lab_orders l join public.profiles p on p.id = l.patient_id where p.full_name like 'LOADGEN%')::int lab_orders,
      (select count(*) from public.encounters e join public.profiles p on p.id = e.patient_id where p.full_name like 'LOADGEN%')::int encounters,
      pg_size_pretty(pg_database_size(current_database())) db_size`)).rows[0];
  return { members, free: F, doctors: D, seconds: (Date.now() - t0) / 1000, timings, counts };
}

function md5Admin(seed) {
  // a fixed, seed-derived uuid for the generator's own admin (referenced by verified_by / granted_by)
  const h = [...`loadgen-admin-${seed}`].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7).toString(16).padStart(8, "0");
  return `${h}-0000-4000-8000-000000000001`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const pool = makePool(args.url, 4);
  try {
    if (args.teardown) { await teardown(pool); console.log("torn down"); }
    else {
      await teardown(pool);
      const r = await generate(pool, args);
      console.log(JSON.stringify({ ...r, machine: machineSpecs() }, null, 2));
    }
  } finally {
    await pool.end();
  }
}
