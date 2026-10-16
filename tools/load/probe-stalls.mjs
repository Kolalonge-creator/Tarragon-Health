// Probe: while N concurrent reading saves run, record every statement that has been running for more than 1.5 s, what it waits on, and who blocks it.
// Usage: node probe-stalls.mjs [concurrency] [total]
import { makePool, asUser, pool as runPool, sleep } from "./lib.mjs";
import { makeIds } from "./scenarios.mjs";

const conc = Number(process.argv[2] ?? 20);
const total = Number(process.argv[3] ?? 3000);
const url = process.env.LOAD_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54397/postgres";
const db = makePool(url, conc + 2);
const admin = makePool(url, 2);
const ids = makeIds(1);
const members = Number((await db.query("select count(*)::int n from public.profiles where full_name like 'LOADGEN member %'")).rows[0].n);
const org = (await db.query("select id from public.organisations order by created_at limit 1")).rows[0].id;
const seen = new Map();
let stop = false;
const sampler = (async () => {
  while (!stop) {
    const r = await admin.query(`select pid, now() - query_start age, coalesce(wait_event_type,'cpu') t, coalesce(wait_event,'') e, left(regexp_replace(query, '\\s+', ' ', 'g'), 90) q, backend_type,
        (select string_agg(left(regexp_replace(b.query, '\\s+', ' ', 'g'), 70) || ' [' || b.state || ']', ' | ') from pg_stat_activity b where b.pid = any(pg_blocking_pids(a.pid))) blockers
      from pg_stat_activity a where datname = current_database() and state = 'active' and pid <> pg_backend_pid() and now() - query_start > interval '1500 ms'`);
    for (const x of r.rows) {
      const k = `${x.backend_type} | ${x.t}/${x.e} | ${x.q} | blockers: ${x.blockers ?? "none"}`;
      const prev = seen.get(k) ?? { n: 0, maxAge: 0 };
      seen.set(k, { n: prev.n + 1, maxAge: Math.max(prev.maxAge, Number(x.age?.seconds ?? 0) + Number(x.age?.milliseconds ?? 0) / 1000) });
    }
    await sleep(250);
  }
})();
const t0 = Date.now();
const lat = [];
await runPool(total, conc, async (n) => {
  const i = 1 + (n % members);
  const t1 = Date.now();
  await asUser(db, ids.member(i), (c) => c.query("insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source) values ($1,$2,'blood_pressure',120,80,now(),'manual')", [org, ids.member(i)])).catch(() => {});
  lat.push(Date.now() - t1);
});
stop = true; await sampler;
lat.sort((a, b) => a - b);
console.log(`${total} saves at concurrency ${conc} in ${Date.now() - t0} ms; p50 ${lat[Math.floor(lat.length / 2)]} p95 ${lat[Math.floor(lat.length * 0.95)]} max ${lat[lat.length - 1]}`);
for (const [k, v] of [...seen.entries()].sort((a, b) => b[1].maxAge - a[1].maxAge).slice(0, 12)) console.log(`${v.maxAge.toFixed(1)}s max, ${v.n} samples :: ${k}`);
await db.end(); await admin.end();
