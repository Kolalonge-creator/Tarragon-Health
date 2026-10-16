// Probe: run N concurrent reading saves and sample what the sessions are waiting on. Usage: node probe-waits.mjs [concurrency] [total]
import { makePool, asUser, pool as runPool, sleep } from "./lib.mjs";
import { makeIds } from "./scenarios.mjs";

const conc = Number(process.argv[2] ?? 20);
const total = Number(process.argv[3] ?? 200);
const mode = process.argv[4] ?? 'normal'; // normal | freered | memberred
const url = process.env.LOAD_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54397/postgres";
const db = makePool(url, conc + 2);
const admin = makePool(url, 2);
const ids = makeIds(1);
const org = (await db.query("select id from public.organisations order by created_at limit 1")).rows[0].id;
const waits = new Map();
let stop = false;
const sampler = (async () => {
  while (!stop) {
    const r = await admin.query("select coalesce(wait_event_type,'cpu') t, coalesce(wait_event,'') e, left(query, 60) q, count(*)::int n from pg_stat_activity where datname = current_database() and state = 'active' and pid <> pg_backend_pid() and query ilike '%vitals_readings%' or (state='active' and wait_event_type = 'Lock') group by 1,2,3");
    for (const x of r.rows) waits.set(`${x.t}/${x.e} :: ${x.q}`, (waits.get(`${x.t}/${x.e} :: ${x.q}`) ?? 0) + x.n);
    await sleep(50);
  }
})();
const t0 = Date.now();
await runPool(total, conc, async (n) => {
  const i = 1 + (n % 500);
  const pid = mode === 'freered' ? ids.free(i) : ids.member(i);
  const sys = mode === 'normal' ? 120 : 195;
  const t1 = Date.now();
  await asUser(db, pid, (c) => c.query("insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source) values ($1,$2,'blood_pressure',$3,80,now(),'manual')", [org, pid, sys])).catch((e) => console.log("err", e.message));
  if (total <= 12) console.log('call', n, Date.now() - t1, 'ms');
});
stop = true; await sampler;
console.log(`${total} inserts at concurrency ${conc} in ${Date.now() - t0} ms`);
console.log([...waits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8));
await db.end(); await admin.end();
