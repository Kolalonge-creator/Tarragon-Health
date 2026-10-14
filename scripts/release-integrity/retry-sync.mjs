// Shared retry for `supabase db query --linked`. The CLI creates a temporary login role per call and dies with
// "unexpected login role status 544 ... Connection terminated" when two calls race for it (the Release Integrity
// database jobs, or another workflow, starting together). Retrying with a growing, jittered wait absorbs that.
import { execFileSync } from "node:child_process";

export function runWithRetry(run, { attempts = 5, baseMs = 4000, sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms), log = console.log } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return run();
    } catch (err) {
      lastErr = err;
      if (i === attempts) break;
      const wait = baseMs * 2 ** (i - 1) + Math.floor(Math.random() * 1000);
      log(`attempt ${i}/${attempts} failed (${err instanceof Error ? err.message.split("\n")[0] : err}); retrying in ${wait}ms`);
      sleep(wait);
    }
  }
  throw lastErr;
}

export function execWithRetry(cmd, args, opts = {}) {
  return runWithRetry(() => execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 50, ...opts }));
}
