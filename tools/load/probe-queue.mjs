// Probe: D doctors call queue_next at once for T tasks; record latency, and every statement running longer than 700 ms with what it waits on.
// Usage: node probe-queue.mjs [doctors] [tasks] [pool]
import { makePool, asUser, sleep } from "./lib.mjs";
import { makeIds } from "./scenarios.mjs";

const D = Number(process.argv[2] ?? 55);
const T = Number(process.argv[3] ?? 40);
const P = Number(process.argv[4] ?? 20);
const url = process.env.LOAD_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54397/postgres";
const db = makePool(url, P + 2);
const admin = makePool(url, 2);
const ids = makeIds(1);
for (let n = 0; n < T; n++) await db.query("select private.create_clinical_task($1, 'amber_bp_review', $2)", [ids.member(1 + n), 300 + n]);
const seen = new Map();
let stop = false;
const sampler = (async () => {
  while (!stop) {
    const r = await admin.query(`select coalesce(wait_event_type,'cpu') t, coalesce(wait_event,'') e, left(regexp_replace(query, '\\s+', ' ', 'g'), 80) q, extract(epoch from now() - query_start)::numeric(8,2) age,
        (select string_agg(left(regexp_replace(b.query, '\\s+', ' ', 'g'), 60), ' | ') from pg_stat_activity b where b.pid = any(pg_blocking_pids(a.pid))) blockers
      from pg_stat_activity a where datname = current_database() and state = 'active' and pid <> pg_backend_pid() and now() - query_start > interval '700 ms'`);
    for (const x of r.rows) {
      const k = `${x.t}/${x.e} :: ${x.q} :: blockers ${x.blockers ?? "none"}`;
      const p = seen.get(k) ?? { n: 0, age: 0 };
      seen.set(k, { n: p.n + 1, age: Math.max(p.age, Number(x.age)) });
    }
    await sleep(200);
  }
})();
const lat = [];
const t0 = Date.now();
let next = 0;
await Promise.all(Array.from({ length: P }, async () => {
  for (;;) {
    const n = next++;
    if (n >= D) return;
    const t1 = Date.now();
    await asUser(db, ids.doctor(1 + n), (c) => c.query("select public.queue_next(null)")).catch((e) => console.log("err", e.message));
    lat.push(Date.now() - t1);
  }
}));
stop = true; await sampler;
lat.sort((a, b) => a - b);
console.log(`${D} doctors, ${T} tasks, pool ${P}: total ${Date.now() - t0} ms; p50 ${lat[Math.floor(lat.length / 2)]} p95 ${lat[Math.floor(lat.length * 0.95)]} max ${lat[lat.length - 1]}`);
for (const [k, v] of [...seen.entries()].sort((a, b) => b[1].age - a[1].age).slice(0, 8)) console.log(`${v.age}s, ${v.n} samples :: ${k}`);
await db.end(); await admin.end();
