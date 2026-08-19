#!/usr/bin/env node
// Catches the failure mode logged in CLAUDE.md's 2026-08-04 entry: Vercel builds a push to
// `main` successfully, but the deployment's `target` never becomes "production" (the GitHub
// webhook -> promotion step silently doesn't fire), so the live domain keeps serving an older
// deployment with no error anywhere. Nothing previously checked for this after the fact.
//
// Usage: VERCEL_TOKEN=... node verify-vercel-promotion.mjs <expectedCommitSha>
// Exits non-zero (and prints a clear diagnosis) if no READY, target=production deployment for
// that commit shows up within the timeout.

const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID || "team_m0aKwXH1XeY2LYtq6urecmk4";
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID || "prj_mhUTlvnSc6a2JdJvnIOmn7fMjEw4";
const TOKEN = process.env.VERCEL_TOKEN;
const TIMEOUT_MS = Number(process.env.PROMOTION_TIMEOUT_MINUTES ?? 15) * 60_000;
const POLL_MS = Number(process.env.PROMOTION_POLL_SECONDS ?? 20) * 1000;

const expectedSha = process.argv[2] || process.env.EXPECTED_SHA;

if (!TOKEN) {
  console.error("VERCEL_TOKEN is not set — cannot check Vercel deployment status.");
  process.exit(2);
}
if (!expectedSha) {
  console.error("Usage: node verify-vercel-promotion.mjs <expectedCommitSha>");
  process.exit(2);
}

async function listDeployments(params) {
  // GET /v7/deployments is the current documented list endpoint (confirmed against Vercel's
  // published OpenAPI spec) — deployment objects here use `uid` and `readyState`, not the `id`/
  // `state` shape some older tooling assumes.
  const url = new URL("https://api.vercel.com/v7/deployments");
  url.searchParams.set("projectId", VERCEL_PROJECT_ID);
  url.searchParams.set("teamId", VERCEL_TEAM_ID);
  url.searchParams.set("limit", "20");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) {
    throw new Error(`Vercel API ${res.status}: ${await res.text()}`);
  }
  const body = await res.json();
  return body.deployments ?? [];
}

function matchesCommit(deployment) {
  const sha = deployment.meta?.githubCommitSha;
  return sha && (sha === expectedSha || sha.startsWith(expectedSha) || expectedSha.startsWith(sha));
}

async function main() {
  const deadline = Date.now() + TIMEOUT_MS;
  console.log(`Watching for a production deployment of commit ${expectedSha} (timeout ${TIMEOUT_MS / 60_000}m)...`);

  while (Date.now() < deadline) {
    const productionDeployments = await listDeployments({ target: "production", sha: expectedSha });
    const match = productionDeployments.find(matchesCommit);

    if (match) {
      if (match.readyState === "READY") {
        console.log(`OK: production is serving commit ${expectedSha} (deployment ${match.uid}, ${match.url}).`);
        process.exit(0);
      }
      if (match.readyState === "ERROR" || match.readyState === "CANCELED") {
        console.error(`Production deployment for ${expectedSha} reached state ${match.readyState} — it will not recover on its own.`);
        console.error(`Inspect: https://vercel.com/${VERCEL_TEAM_ID}/${VERCEL_PROJECT_ID}/${match.uid}`);
        process.exit(1);
      }
      // BUILDING / QUEUED / INITIALIZING — keep polling.
    }

    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  // Timed out. Give a precise diagnosis: did the commit build at all, just never get promoted?
  const anyDeployments = await listDeployments({ sha: expectedSha });
  const unpromoted = anyDeployments.find((d) => matchesCommit(d) && d.readyState === "READY" && d.target !== "production");

  console.error(`TIMEOUT: no READY production deployment for commit ${expectedSha} after ${TIMEOUT_MS / 60_000} minutes.`);
  if (unpromoted) {
    console.error(
      `Found a READY build for this commit (deployment ${unpromoted.uid}, ${unpromoted.url}) but its target is ` +
        `"${unpromoted.target ?? "null"}", not "production" — this is the exact silent-non-promotion failure mode ` +
        `documented in CLAUDE.md's 2026-08-04 entry. Promote it manually from the Vercel dashboard, or push a new ` +
        `commit to retrigger the GitHub webhook.`,
    );
  } else {
    console.error(
      `No deployment at all matches this commit yet (built or not) — check the Vercel dashboard / GitHub webhook ` +
        `delivery log directly, this may be a build failure rather than a promotion failure.`,
    );
  }
  process.exit(1);
}

main().catch((err) => {
  console.error("verify-vercel-promotion failed:", err);
  process.exit(2);
});
