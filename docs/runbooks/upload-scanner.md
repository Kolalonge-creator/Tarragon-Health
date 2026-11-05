# Upload malware scanner (T2-08)

Every uploaded clinical document (lab report, S27 lab file, ECG, imaging, "not sure what this is") is scanned by Tarragon's own
ClamAV service before it is stored. Founder decision T2-08: self-hosted on Tarragon's Railway account, no third-party scanner,
uploads held until scanned. Code: `services/scanner` (the service), `packages/shared/src/scanner-client.ts` (client),
`apps/web/src/lib/upload-scan/` (scan before store, hold, retry), migration `20261104233613_t2_08_upload_malware_scan.sql` (the
scan as a step and a status of the clinical document intake). The file-format check (PR #1681) still runs first.

## What happens to an upload

| Scanner says | The file | The patient or staff uploader | Ops |
|---|---|---|---|
| Not configured (`SCANNER_SERVICE_URL` empty) | Stored, `scan_status = unscanned`, processed as before T2-08 | Nothing changes | Nothing |
| Clean | Stored, `clean`, processed normally | Nothing changes | Nothing |
| Infected | **Never stored.** Any later attempt to file the same bytes is refused by the database | Calm refusal: ask the lab for a fresh copy or take a new photo | Security incident `upload-scan-infected:<fingerprint>` (sev2) |
| Unreachable, timed out, or could not scan | Stored but **held** (`pending_scan`): no AI reading, no signed link for anyone | Upload succeeds; the care team's upload alert still fires | Technical incident `upload-scanner-unavailable` (sev2), opened at once and kept current |

A held document is not lost and the clinical path is not blocked: the clinician still gets the upload alert and can contact the
patient; only the file itself waits. If the hold cannot even be recorded (database error), the upload is refused with "try again
in a few minutes" rather than stored unscanned.

## The retry

The daily `/api/cron/clinical-document-retry` (Vercel cron, 07:15 UTC; Vercel's plan allows only daily crons) runs the scan step
first: it rescans every `pending_scan` document whose back-off has passed (1h, 2h, 4h ... capped at 24h, counted in
`clinical_documents.scan_attempts`), starts the reader on the ones now clean, and refreshes the ops incident. Each attempt is a
`clinical_document_jobs` row with `step = 'scan'`. It also backfills `unscanned` documents once the scanner is configured, so a
file that predates the scanner, or reached the database some other way, is scanned within a day; an infected one found that way
is set `infected` (link withheld) and a security incident is opened. An infected document is never released automatically.

To rescan **now** (for example once the scanner is back), call the route by hand with the Vercel `CRON_SECRET`:

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" https://app.tarragonhealth.ng/api/cron/clinical-document-retry
```

The JSON reply has a `scan` block: `considered`, `clean`, `infected`, `stillHeld`, `held` (documents still waiting) and
`readersStarted`.

## Deploy on Railway (founder approval needed; not done by any agent)

1. In the Railway project, add a service from this GitHub repo. Root directory `services/scanner`. Railway reads
   `services/scanner/railway.json` (Dockerfile build, health check `/ready` with a 300 s timeout, restart on failure).
2. Plan: give it at least **2 GB of memory** (clamd holds the signature database in memory, about 1.2 to 1.5 GB). One replica.
   Region: the closest to Vercel `dub1` (an EU region).
3. Variables on the Railway service: `SCANNER_SERVICE_KEY` = a new random secret (for example `openssl rand -hex 32`),
   `ENVIRONMENT=production`. Do not set `PORT`; Railway provides it.
4. Networking: generate a Railway public domain (HTTPS). The service has no other inbound route. Nothing else is exposed: clamd
   listens on loopback only.
5. Wait for the first deploy to pass `/ready` (signatures load in 30 to 90 s). Check:
   `curl https://<railway-domain>/health` should show `"clamd": "up"` and a recent `db_date`.
6. Smoke test with the EICAR test file (harmless, every antivirus flags it):
   `printf '%s' 'X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*' | curl -s -H "X-Service-Key: $SCANNER_SERVICE_KEY" -H 'Content-Type: application/octet-stream' --data-binary @- https://<railway-domain>/scan`
   should return `"status":"infected"`.
7. In Vercel (`tarragon-health-web`, Production and Preview): set `SCANNER_SERVICE_URL=https://<railway-domain>` and
   `SCANNER_SERVICE_KEY=<same secret>`. Redeploy. From then on every upload is scanned.
8. Apply order: the migration must be live before the web code that calls it (it auto-applies on merge to `main-dev`). The web
   code with `SCANNER_SERVICE_URL` unset does nothing new, so merging before Railway is up is safe.

Rotate the key: set the new value on Railway, then on Vercel, then redeploy Vercel. Between the two, uploads are held (not lost)
and rescanned by the next retry.

## When the scanner is down

You will see the `upload-scanner-unavailable` incident on `/admin/incidents`. Uploads keep working and are held.

1. `curl https://<railway-domain>/ready`. 503 = clamd not loaded or dead; check Railway logs. Common causes: out of memory
   (raise the memory limit), the signature mirror refusing updates (the image carries a baked signature set, so it still starts;
   rebuild the image to refresh it), a failed deploy.
2. Fix and wait for `/ready` = 200, then run the retry by hand (above). Confirm `held` goes to 0, then resolve the incident.
3. If the scanner will be down for a long time, the held files stay held. That is the intended safe state. Do NOT unset
   `SCANNER_SERVICE_URL` to "release" them: it does not release held files (they stay `pending_scan`), it only stops scanning new
   ones.

## When malware is found

The `upload-scan-infected:<fingerprint>` incident names the signature and where it was found. At upload time nothing was
stored. Found by the retry: the file is held in storage (not deleted; deleting clinical data is a human decision) and no link
to it is issued.

1. Find the document: `select id, patient_id, uploaded_by, upload_channel, scan_signature from clinical_documents where scan_status = 'infected'`.
2. Was it a test (EICAR signature)? Then resolve the incident. Otherwise treat it as a suspected security incident:
   `docs/runbooks/cybersecurity-incident-runbook.md`. Ask the uploader (patient or lab) for a clean copy through the care team.
3. The upload's account may be compromised if it uploads malware repeatedly: check `upload_scan_verdicts` for the same
   `uploaded_by`.

## Known limits

- Scanning covers clinical document uploads only (the four buckets above). Other uploads (vaccination cards, outside records,
  care-message attachments, community pictures) are not scanned yet.
- A patient could in principle bypass the server and write a lab document row directly through their own database session.
  That row arrives `unscanned` (not held), and the daily backfill scans it within a day. Holding unknown files by default would
  have held every upload before the scanner exists.
- A scanned file cannot be swapped afterwards: the migration drops the patients' storage UPDATE policies on the document
  buckets (no platform code used them; every upload goes to a fresh path), and the patients' storage INSERT policies refuse a
  path that a document row already names (`private.storage_path_in_record`), so delete-then-re-upload at the same path fails.
  The patient keeps DELETE (the upload rollbacks use it); deleting only removes their own file, it cannot swap it.
- A clean verdict is by fingerprint: the same bytes uploaded again reuse it. A later signature update does not rescan old clean
  files.
