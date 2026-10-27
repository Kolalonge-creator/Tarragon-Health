// W-40: stage sizes for the HTTP load scripts. Same stages as the database-layer harness in tools/load/targets.mjs
// (A 500, B 5,000, C 25,000 Members). PROPOSED values: the CMO and founder have not signed the targets.
// Pick a stage with -e STAGE=A|B|C.

export const STAGES = {
  A: { members: 500, doctors: 8, ramp: "2m", hold: "5m", nextTaskPerDoctorPerMin: 4 },
  B: { members: 5000, doctors: 60, ramp: "5m", hold: "10m", nextTaskPerDoctorPerMin: 4 },
  C: { members: 25000, doctors: 250, ramp: "10m", hold: "15m", nextTaskPerDoctorPerMin: 4 },
};

// Same proposed targets as tools/load/targets.mjs. The error rate and latency become k6 thresholds.
export const TARGETS = { nextTaskP95Ms: 2000, errorRateMax: 0.01 };

export function stage() {
  const key = (__ENV.STAGE || "A").toUpperCase();
  const s = STAGES[key];
  if (!s) throw new Error(`Unknown STAGE ${key}; use A, B or C`);
  return { key, ...s };
}

/** Refuse to run against the live project. Load generators write rows; use a branch, a scratch project or the local stack. */
export function assertNotProduction(url) {
  if (!url) throw new Error("SUPABASE_URL is not set");
  if (/koiplnmbgnqnbywhpjlf/.test(url)) throw new Error("Refusing to load-test the live Tarragon Health project");
  if (/tarragonhealth\.ng/.test(url)) throw new Error("Refusing to load-test the production site");
}
