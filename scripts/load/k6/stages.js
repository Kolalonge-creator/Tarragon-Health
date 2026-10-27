// W-40: settings for the k6 scripts in this folder.
//
// SCOPE, stated plainly: these k6 scripts exercise public.queue_next ONLY (clinicians asking for their next task through PostgREST).
// They do NOT generate red-event, page, reading-save or chart traffic. That load, and the red-page and reading-save safety checks,
// come from tools/load (the database-layer harness: node tools/load/run.mjs --stage A|B|C|D), which also builds the 500 / 5,000 /
// 25,000 Member populations. So the stages below are QUEUE-ONLY stages: they set how many doctors ask at once. The Member count is
// whatever tools/load/generate.mjs put in the database; nothing here creates or sends Member traffic.
//
// PROPOSED values: the CMO and founder have not signed the targets. Pick a stage with -e STAGE=A|B|C.

export const STAGES = {
  A: { doctors: 8, ramp: "2m", hold: "5m", nextTaskPerDoctorPerMin: 4, populationHint: "tools/load stage A (500 Members)" },
  B: { doctors: 60, ramp: "5m", hold: "10m", nextTaskPerDoctorPerMin: 4, populationHint: "tools/load stage B (5,000 Members)" },
  C: { doctors: 250, ramp: "10m", hold: "15m", nextTaskPerDoctorPerMin: 4, populationHint: "tools/load stage C (25,000 Members)" },
};

// Same proposed targets as tools/load/targets.mjs.
export const TARGETS = { nextTaskP95Ms: 2000, errorRateMax: 0.01 };

export function stage() {
  const key = (__ENV.STAGE || "A").toUpperCase();
  const s = STAGES[key];
  if (!s) throw new Error(`Unknown STAGE ${key}; use A, B or C`);
  return { key, ...s };
}

const LIVE_PROJECT_REF = "koiplnmbgnqnbywhpjlf";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "host.docker.internal"]);

/**
 * Where the load may point. ALLOWLIST: a local host, or a Supabase project ref listed in allowedRefs (the LOAD_TEST_PROJECT_REFS
 * environment variable, comma separated). Anything else is refused. The live project and the production domain are named and refused
 * first as an extra guard, even if someone lists them.
 * Returns { ok: boolean, reason: string }.
 */
export function checkTarget(url, allowedRefs = "") {
  if (!url || typeof url !== "string") return { ok: false, reason: "SUPABASE_URL is not set" };
  const m = url.trim().match(/^https?:\/\/([^/:?#]+)(?::\d+)?(?:[/?#]|$)/i);
  if (!m) return { ok: false, reason: `Cannot read a host from ${url}` };
  const host = m[1].toLowerCase();
  if (host.includes(LIVE_PROJECT_REF)) return { ok: false, reason: "Refusing to load-test the live Tarragon Health project" };
  if (/(^|\.)tarragonhealth\.ng$/.test(host)) return { ok: false, reason: "Refusing to load-test the production site" };
  if (LOCAL_HOSTS.has(host)) return { ok: true, reason: "local host" };
  const ref = host.match(/^([a-z0-9]{20})\.supabase\.(co|in)$/);
  const refs = String(allowedRefs || "").split(",").map((r) => r.trim().toLowerCase()).filter(Boolean);
  if (ref && refs.includes(ref[1])) return { ok: true, reason: `project ${ref[1]} is in LOAD_TEST_PROJECT_REFS` };
  return { ok: false, reason: `${host} is not a local host and its project ref is not in LOAD_TEST_PROJECT_REFS` };
}

export function assertNotProduction(url, allowedRefs = typeof __ENV !== "undefined" ? __ENV.LOAD_TEST_PROJECT_REFS : "") {
  const r = checkTarget(url, allowedRefs);
  if (!r.ok) throw new Error(r.reason);
}
