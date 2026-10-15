// Shared helpers for the SR4 load harness. Local, disposable databases only.
import pg from "pg";
import os from "node:os";

export const ALLOW_REMOTE_PHRASE = "yes-i-know-this-is-disposable";

/** Refuses anything that does not look like a local throwaway database. Never point this at the live project. */
export function assertLocalUrl(url) {
  const local = /@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url) || url.includes("host=/");
  if (!local && process.env.LOAD_ALLOW_REMOTE !== ALLOW_REMOTE_PHRASE) {
    console.error(`REFUSING: ${url.replace(/:[^:@/]*@/, ":***@")} does not look local. Load tests must never run against production.`);
    process.exit(2);
  }
  if (/koiplnmbgnqnbywhpjlf/.test(url)) {
    console.error("REFUSING: that is the live Tarragon project.");
    process.exit(2);
  }
}

export function makePool(url, max) {
  assertLocalUrl(url);
  const pool = new pg.Pool({ connectionString: url, max, idleTimeoutMillis: 30000 });
  pool.on("error", () => {});
  return pool;
}

/** Run fn inside a transaction as an authenticated user, the way PostgREST does it for a signed-in browser or app. */
export async function asUser(pool, uid, fn, { role = "authenticated", statementTimeoutMs = 15000 } = {}) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('statement_timeout', $3, true)",
      [JSON.stringify({ sub: uid, role }), uid, String(statementTimeoutMs)]);
    await c.query(`set local role ${role}`);
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    try { await c.query("rollback"); } catch { /* ignore */ }
    throw e;
  } finally {
    c.release();
  }
}

export async function asService(pool, fn) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)");
    await c.query("set local role service_role");
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    try { await c.query("rollback"); } catch { /* ignore */ }
    throw e;
  } finally {
    c.release();
  }
}

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

/** Collects latencies (ms) and outcomes for one scenario. */
export class Recorder {
  constructor(name) { this.name = name; this.lat = []; this.ok = 0; this.err = 0; this.errors = new Map(); this.startedAt = Date.now(); this.endedAt = null; this.extra = {}; }
  async time(fn) {
    const t0 = performance.now();
    try { const r = await fn(); this.lat.push(performance.now() - t0); this.ok++; return r; }
    catch (e) {
      this.lat.push(performance.now() - t0); this.err++;
      const k = `${e.code ?? "?"}: ${String(e.message).slice(0, 80)}`;
      this.errors.set(k, (this.errors.get(k) ?? 0) + 1);
      return undefined;
    }
  }
  finish() { this.endedAt = Date.now(); return this; }
  summary() {
    const s = [...this.lat].sort((a, b) => a - b);
    const total = this.ok + this.err;
    const secs = Math.max(0.001, ((this.endedAt ?? Date.now()) - this.startedAt) / 1000);
    return {
      name: this.name, calls: total, ok: this.ok, errors: this.err,
      errorRate: total ? this.err / total : 0,
      p50: percentile(s, 50), p95: percentile(s, 95), p99: percentile(s, 99), max: s.length ? s[s.length - 1] : null,
      seconds: secs, perSecond: total / secs,
      errorKinds: [...this.errors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
      ...this.extra,
    };
  }
}

/** Run `n` tasks with at most `concurrency` in flight. */
export async function pool(n, concurrency, worker) {
  let next = 0;
  const lanes = Array.from({ length: Math.min(concurrency, n) }, async () => {
    for (;;) { const i = next++; if (i >= n) return; await worker(i); }
  });
  await Promise.all(lanes);
}

/** Samples pg_stat_activity connection counts while a scenario runs. */
export function sampleConnections(admin, everyMs = 500) {
  const samples = [];
  let stop = false;
  const loop = (async () => {
    while (!stop) {
      try {
        const r = await admin.query("select count(*)::int total, count(*) filter (where state = 'active')::int active, count(*) filter (where wait_event_type = 'Lock')::int waiting_lock from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()");
        samples.push(r.rows[0]);
      } catch { /* ignore */ }
      await sleep(everyMs);
    }
  })();
  return async () => {
    stop = true; await loop;
    return {
      samples: samples.length,
      maxTotal: Math.max(0, ...samples.map((s) => s.total)),
      maxActive: Math.max(0, ...samples.map((s) => s.active)),
      maxWaitingOnLock: Math.max(0, ...samples.map((s) => s.waiting_lock)),
    };
  };
}

export function machineSpecs() {
  const cpus = os.cpus();
  return {
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpu: cpus[0]?.model ?? "unknown",
    cores: cpus.length,
    memGiB: Math.round(os.totalmem() / 2 ** 30),
    node: process.version,
    loadAverage: os.loadavg().map((x) => Math.round(x * 10) / 10),
  };
}

export const fmt = (n, d = 1) => (n === null || n === undefined ? "n/a" : Number(n).toFixed(d));
