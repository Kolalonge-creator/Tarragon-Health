# S06 follow-up research: how other offline-first platforms do it

Date 2026-10-02. Behaviour and ideas only. `CLAUDE.md` rule 11 and the S06 prompt forbid copying code, text or design from reference platforms. Nothing here was copied or adopted. Any open-source library or code would need its licence checked first (several health platforms use copyleft licences, not verified here) and a founder decision.

## Sources read
- Community Health Toolkit, "Offline-First in the CHT" (docs.communityhealthtoolkit.org): PouchDB on the phone, replicated to CouchDB.
- CommCare HQ platform overview (commcare-hq.readthedocs.io): incremental sync by hashed state diff.
- PowerSync docs, "Writing client changes" (docs.powersync.com): upload queue and checkpoints.
- WatermelonDB, RxDB and general React Native outbox write-ups (checkpoint resume, backoff, dedupe).
- Android architecture guide, "Build an offline-first app": queue-then-sync with WorkManager.

## What they do that S06 does not yet

| Idea | Who | S06 today | Worth doing? |
|---|---|---|---|
| **Purge and replication depth.** Old data is archived or purged from the phone, and how much history replicates is configurable. | CHT | The mirror only grows. First pull reads 90 days, but nothing ever deletes rows. On a 2 GB phone this is a storage risk over months. | **Yes, small.** Purge mirror rows older than N days on each pull. Keep the outbox untouched. |
| **Rejected writes are visible server-side.** A refused write is recorded in a table that syncs back, so it never blocks the queue and support can see it. | PowerSync | A rejected row is visible only on the phone (banner, support code). Support cannot see it without the phone. | **Yes.** A small `offline_sync_rejections` table, written best-effort when a row is first rejected (id, kind, reason, no health values), so the care team and support can follow up. Needs a design for PHI minimisation. |
| **Integrity check of the mirror.** The phone sends a hash or count of its state and the server replies with the diff. | CommCare | The cursor overlap is 10 minutes, so a row committed later than that is missed (documented limit, tested). | **Maybe.** A cheap per-table count compare after each pull would detect drift and trigger a wider re-read. |
| **Gate the pull on an empty upload queue**, so the phone never reads a state that lacks its own pending writes. | PowerSync | The mirror is append-only and unsent doses are overlaid on reads, so this is handled differently. | No change needed. |
| **Guaranteed background delivery.** Android WorkManager retries queued network calls when the OS allows. | Android guide | The 15 minute background task, app open and sign-in flush. No reconnect trigger (no NetInfo dependency). | **Yes, already a follow-up.** Add NetInfo, or accept the floor, once a device lab run shows how long rows actually wait. |
| **Never block the user, no spinners on server calls.** Replication is silent unless it fails. | CHT | Same: logging is local and instant, the banner appears only for waiting, stuck or rejected rows. | Already aligned. |
| **Fatal versus retryable classes.** 4xx is terminal, 5xx retries with backoff. | PowerSync, outbox libraries | Same split (`classifyFailure`). We keep rejected rows instead of dropping them. | Already aligned. |
| **Resume from the last checkpoint after a failed sync.** | WatermelonDB | Per-table cursor, advanced only after rows are stored. | Already aligned. |

## Capabilities seen elsewhere, not in S06 scope
- Conflict handling for edited records (last write wins, field merge). S06 has none because patient-authored rows are append-only and clinician-authored rows are server-wins. It becomes relevant only if a patient can edit a reading, which INV and S05 do not allow.
- Offline forms and questionnaires (CommCare). Spec D.1 lists questionnaires and symptom-check answers; only symptoms, readings and doses queue today.
- Per-user sync scope rules (CommCare, CHT): what each user's phone is allowed to hold. Relevant if a supporter's phone holds a beneficiary's mirror; today the mirror is wiped on sign-out.

## Suggested next steps (not built)
1. Mirror purge by age (small, safe, no founder question).
2. Server-side record of rejected rows with no health values (needs a short design and a founder yes on what support may see).
3. Post-pull count check to detect rows missed beyond the overlap.
4. Reconnect trigger once real device data shows the wait time.

## Unsafe or unsuitable for Nigeria
- Always-on replication over cellular for a full history (data cost): keep the 90 day first pull and page caps.
- Silent drop of a failed write after N tries (several outbox libraries do this): never, a reading is a clinical fact.
- Last-write-wins on readings: would let a retry overwrite a true time.
