// SR4 load run: node run.mjs --stage A [--url ...] [--pool 40] [--seed 1] [--only morning,red] [--skip-generate] [--skip-race-scripts]
// Writes docs/design/load-results/<stage>.md and .json. Refuses any database that does not look local.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makePool, machineSpecs, fmt } from "./lib.mjs";
import { generate, teardown, doctorsFor } from "./generate.mjs";
import { SCENARIOS, makeIds } from "./scenarios.mjs";
import { STAGES, TARGETS } from "./targets.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");

function args() {
  const a = { stage: "A", url: process.env.LOAD_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54397/postgres", pool: 40, seed: 1, only: null, skipGenerate: false, skipRace: false, members: null, dbNote: "" };
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) {
    if (v[i] === "--stage") a.stage = v[++i];
    else if (v[i] === "--url") a.url = v[++i];
    else if (v[i] === "--pool") a.pool = Number(v[++i]);
    else if (v[i] === "--seed") a.seed = Number(v[++i]);
    else if (v[i] === "--members") a.members = Number(v[++i]);
    else if (v[i] === "--only") a.only = v[++i].split(",");
    else if (v[i] === "--skip-generate") a.skipGenerate = true;
    else if (v[i] === "--skip-race-scripts") a.skipRace = true;
    else if (v[i] === "--db-note") a.dbNote = v[++i];
  }
  return a;
}

function runScript(file, url) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn("bash", [path.join(repo, "packages/db/tests", file)], { env: { ...process.env, DATABASE_URL: url, PGSSLMODE: "disable", PGPASSWORD: process.env.PGPASSWORD ?? "postgres" }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => p.kill("SIGKILL"), 15 * 60 * 1000);
    p.on("close", (code) => { clearTimeout(timer); resolve({ file, code, seconds: (Date.now() - t0) / 1000, output: out.trim().split("\n").slice(-14).join("\n") }); });
  });
}

const mdRow = (s) => `| ${s.name} | ${s.calls} | ${fmt(s.p50)} | ${fmt(s.p95)} | ${fmt(s.p99)} | ${fmt(s.max)} | ${(s.errorRate * 100).toFixed(2)}% | ${fmt(s.perSecond, 0)}/s |`;

async function main() {
  const a = args();
  const stage = STAGES[a.stage];
  if (!stage && !a.members) throw new Error("unknown stage");
  const members = a.members ?? stage.members;
  const db = makePool(a.url, a.pool + 4);
  const admin = makePool(a.url, 2);
  const cfg = { members, pool: a.pool, freePerMember: 4, doctors: doctorsFor(members), seed: a.seed };
  const ids = makeIds(a.seed);
  const org = (await db.query("select id from public.organisations order by created_at limit 1")).rows[0].id;
  const out = { stage: a.stage, members, startedAt: new Date().toISOString(), machine: machineSpecs(), cfg };
  out.dbSettings = Object.fromEntries((await db.query("select name, setting from pg_settings where name in ('max_connections','shared_buffers','work_mem','effective_cache_size','track_io_timing')")).rows.map((r) => [r.name, r.setting]));
  out.postgres = (await db.query("select version() v")).rows[0].v.split(" on ")[0];
  out.cronJobs = (await db.query("select count(*)::int n from cron.job where active")).rows[0].n;

  if (!a.skipGenerate) {
    console.log(`generating ${members} Members...`);
    await teardown(db);
    out.generation = await generate(db, { members, seed: a.seed, freePerMember: 4, doctors: cfg.doctors });
    console.log(`generated in ${out.generation.seconds}s`, out.generation.counts);
  }
  const admin_id = (await db.query("select id from public.profiles where full_name = 'LOADGEN admin'")).rows[0].id;
  out.dataSizes = (await db.query(`select s.relname, s.n_live_tup::bigint rows, pg_size_pretty(pg_total_relation_size(c.oid)) size from pg_stat_user_tables s join pg_class c on c.oid = s.relid where s.relname in ('profiles','vitals_readings','notifications','lab_orders','encounters','clinical_tasks','pages','domain_events') order by pg_total_relation_size(c.oid) desc`)).rows;
  out.dbSize = (await db.query("select pg_size_pretty(pg_database_size(current_database())) s")).rows[0].s;

  const ctx = { db, admin, admin_id, ids, org, cfg };
  out.scenarios = [];
  const names = a.only ?? Object.keys(SCENARIOS);
  for (const name of names) {
    await db.query("select pg_stat_statements_reset()").catch(() => {});
    console.log(`scenario ${name}...`);
    const t0 = Date.now();
    let r;
    try { r = await SCENARIOS[name](ctx); }
    catch (e) { r = { summaries: [], assertions: [{ name: "scenario ran", ok: false, detail: String(e.message) }], notes: [] }; }
    r.name = name; r.seconds = (Date.now() - t0) / 1000;
    r.slow = (await db.query(`select left(regexp_replace(query, '\\s+', ' ', 'g'), 110) q, calls, round(mean_exec_time::numeric, 2) mean_ms, round(total_exec_time::numeric, 0) total_ms from pg_stat_statements
      where dbid = (select oid from pg_database where datname = current_database()) and query not ilike 'begin%' and query not ilike 'commit%' and query not ilike 'rollback%' and query not ilike 'select set_config%' and query not ilike 'set local role%' and query not ilike '%pg_stat%' and query not ilike 'select $1 as%'
      order by total_exec_time desc limit 5`).catch(() => ({ rows: [] }))).rows;
    out.scenarios.push(r);
  }

  out.finalChecks = {};
  out.finalChecks.redUnpaged = (await db.query("select count(*)::int n from public.triage_events t where t.is_test and t.grade = 'red' and not t.shadow and t.patient_id in (select id from public.profiles where full_name like 'LOADGEN%') and not exists (select 1 from public.pages p where p.triage_event_id = t.id and p.parent_page_id is null)")).rows[0].n;
  out.finalChecks.doubleClaims = (await db.query("select count(*)::int n from (select task_id from public.task_claims where ended_at is null group by 1 having count(*) > 1) x")).rows[0].n;
  out.finalChecks.openAlerts = (await db.query("select count(*)::int n from public.ops_alerts where state = 'open'")).rows[0].n;

  if (!a.skipRace) {
    out.raceScripts = [];
    await teardown(db); // the s19 test builds its own rota; ours would overlap it
    await db.end(); await admin.end(); // 50 raw sessions need the connection slots our idle pool would hold (max_connections is 60)
    for (const f of ["s17_queue_concurrent_claim.sh", "s19_page_ack_sweep_race.sh"]) { console.log(`running ${f}...`); out.raceScripts.push(await runScript(f, a.url)); }
  }
  out.endedAt = new Date().toISOString();
  out.dbNote = a.dbNote;

  const dir = path.join(repo, "docs", "design", "load-results");
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `stage-${a.stage.toLowerCase()}`);
  fs.writeFileSync(`${base}.json`, JSON.stringify(out, null, 2));
  fs.writeFileSync(`${base}.md`, render(out));
  console.log(`wrote ${base}.md`);
  if (a.skipRace) { await teardown(db).catch(() => {}); await db.end(); await admin.end(); }
}

function render(o) {
  const L = [];
  const failed = o.scenarios.flatMap((s) => s.assertions.filter((x) => !x.ok).map((x) => `${s.name}: ${x.name}`));
  L.push(`# Load results, Stage ${o.stage} (${o.members.toLocaleString("en")} Members)`, "");
  L.push("> **LOCAL-LAPTOP RESULT. NOT PRODUCTION CAPACITY.** Synthetic `is_test` data, an isolated local Postgres in a container, database layer only: no Next.js, no edge functions, no Expo, Resend, Zoom or Paystack, no network between the client and the database, no PostgREST or pooler. Use these numbers to find what breaks first and to compare stages, never to promise a Member count to anyone (plan section 5).", "");
  L.push(`Run: ${o.startedAt} to ${o.endedAt}. Seed ${o.cfg.seed}.`, "");
  L.push("## Machine and database", "");
  L.push(`- Load generator and database host: ${o.machine.cpu}, ${o.machine.cores} cores, ${o.machine.memGiB} GiB, ${o.machine.platform}, Node ${o.machine.node}.`);
  L.push(`- Host load average (1, 5, 15 min) at the start of the run: ${o.machine.loadAverage.join(", ")}. Other containers and sessions share this machine, so the numbers are noisier and slower than a quiet machine would give; they are not a clean benchmark.`);
  L.push(`- Database: ${o.postgres}, in a Docker container. ${o.dbNote || ""}`);
  L.push(`- Matched to the live project's small tier where it could be (live, read-only look 2026-10-10): max_connections ${o.dbSettings.max_connections}, shared_buffers ${Number(o.dbSettings.shared_buffers) * 8 / 1024} MB. Not the same hardware: cloud shared-core ARM versus a laptop CPU.`);
  L.push(`- ${o.cronJobs} active pg_cron jobs were running in the background during the whole run (the real schedule from the migrations; their HTTP calls to edge functions fail locally, so their cost is understated).`);
  L.push(`- Client pool: ${o.cfg.pool} connections (the database allows ${o.dbSettings.max_connections}).`, "");
  L.push("## Population", "");
  if (o.generation) {
    L.push(`${o.generation.members.toLocaleString("en")} Members, ${o.generation.free.toLocaleString("en")} Free users, ${o.generation.doctors} doctors with a rota and queue availability. Generated in ${o.generation.seconds.toFixed(1)} s.`, "");
    L.push(`Rows: ${JSON.stringify(o.generation.counts)}`, "");
  }
  L.push("| table | rows (estimate) | size incl. indexes |", "|---|---|---|");
  for (const t of o.dataSizes) L.push(`| ${t.relname} | ${t.rows} | ${t.size} |`);
  L.push("", `Database size after generation: ${o.dbSize}.`, "");
  L.push("## Safety assertions at this stage", "");
  const sa = o.scenarios.flatMap((s) => s.assertions.filter((x) => x.name.startsWith("SAFETY")).map((x) => `- ${x.ok ? "PASS" : "**FAIL**"}: ${x.name} (${x.detail})`));
  L.push(...sa);
  L.push(`- ${o.finalChecks.redUnpaged === 0 ? "PASS" : "**FAIL**"}: after every scenario, Member red events without a page: ${o.finalChecks.redUnpaged}`);
  L.push(`- ${o.finalChecks.doubleClaims === 0 ? "PASS" : "**FAIL**"}: after every scenario, tasks with two live claims: ${o.finalChecks.doubleClaims}`);
  if (o.raceScripts) {
    for (const r of o.raceScripts) L.push(`- ${r.code === 0 ? "PASS" : "**FAIL**"}: ${r.file} (the written race test, run for real against this database, ${r.seconds.toFixed(0)} s, exit ${r.code})`, "  ```", ...r.output.split("\n").map((x) => "  " + x), "  ```");
  }
  L.push("", failed.length ? `**Assertions that failed (${failed.length}):** ${failed.join("; ")}` : "No assertion failed.", "");
  L.push("## Scenarios", "", "Latencies are milliseconds for the whole request as the database sees it (a transaction as the signed-in role), measured by the client.", "");
  L.push("| scenario | calls | p50 | p95 | p99 | max | error rate | throughput |", "|---|---|---|---|---|---|---|---|");
  for (const s of o.scenarios) for (const x of s.summaries) L.push(mdRow(x));
  for (const s of o.scenarios) {
    L.push("", `### ${s.name} (${s.seconds.toFixed(1)} s)`, "");
    for (const n of s.notes ?? []) L.push(`- ${n}`);
    if (s.connections) L.push(`- Connections seen (sampled every 250 ms): at most ${s.connections.maxTotal} open, ${s.connections.maxActive} active, ${s.connections.maxWaitingOnLock} waiting on a lock, of ${o.dbSettings.max_connections}.`);
    if (s.pageLadder) L.push(`- Page ladder: create_red_page p50 ${fmt(s.pageLadder.createRedPageP50)} ms, p95 ${fmt(s.pageLadder.createRedPageP95)} ms; the 5 minute sweep over ${s.pageLadder.roots} unacknowledged pages took ${fmt(s.pageLadder.sweepAt6MinutesMs, 0)} ms (${s.pageLadder.backupPagesCreated} backups, ${s.pageLadder.class1TasksCreated} class 1 tasks); the 10 minute sweep took ${fmt(s.pageLadder.sweepAt11MinutesMs, 0)} ms (${s.pageLadder.leadsAlerted} leads alerted). Times are database work only, not the 5 and 10 minute waits themselves.`);
    if (s.queueAge) L.push(`- Notification queue age to send: p50 ${fmt(s.queueAge.p50Seconds, 2)} s, p95 ${fmt(s.queueAge.p95Seconds, 2)} s, max ${fmt(s.queueAge.maxSeconds, 2)} s. Bulk queueing took ${s.queueAge.insertMs} ms.`);
    if (s.drain) L.push(`- Drain: ${s.drain.notices} notices in ${fmt(s.drain.seconds, 1)} s, ${fmt(s.drain.noticesPerSecond, 0)} per second.`);
    for (const x of s.assertions) L.push(`- ${x.ok ? "PASS" : "**FAIL**"}: ${x.name} (${x.detail})`);
    for (const x of s.summaries) if (x.errorKinds?.length) L.push(`- Error kinds for "${x.name}": ${JSON.stringify(x.errorKinds)}`);
    if (s.slow?.length) { L.push("", "Slowest statements by total time (pg_stat_statements, reset before this scenario):", "", "| statement | calls | mean ms | total ms |", "|---|---|---|---|"); for (const q of s.slow) L.push(`| \`${q.q.replaceAll("|", "/")}\` | ${q.calls} | ${q.mean_ms} | ${q.total_ms} |`); }
  }
  L.push("", "## Service targets (PROPOSED, unsigned) against this run", "", `Page to on-call within ${TARGETS.pageToOnCallSeconds} s; reading save p95 within ${TARGETS.readingSaveP95Ms} ms; next task p95 within ${TARGETS.nextTaskP95Ms} ms; chart summary within ${TARGETS.chartSummaryP95Ms} ms. The chart summary is not measured by any scenario here. See each scenario's assertions above.`, "");
  L.push("## What this does not tell you", "", "- Anything about the web tier, serverless cold starts, the pooler, PostgREST, edge functions or third parties.", "- Anything about cloud disk, memory pressure or noisy neighbours.", "- Real user behaviour: arrival is a closed-loop burst, not a human curve.", "- Triggers skipped in bulk generation (risk scores, timeline rows, points): live tables will be heavier than this population.", "");
  return L.join("\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
