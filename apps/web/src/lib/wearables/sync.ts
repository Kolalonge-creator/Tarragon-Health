import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import {
  consentFromConnection,
  getValidAccessToken,
  WEARABLE_CREDENTIAL_COLUMNS,
  type WearableConnectionCredentials,
} from "./connection-tokens";
import { ingestReadings, WearableIngestError, type IngestResult } from "./ingest";
import type { NormalisedReading } from "./normalise";
import type { CloudOAuthWearableProvider } from "./oauth-providers";
import { PROVIDER_ADAPTERS } from "./providers";
import { isGarminPingPullPayload } from "./providers/garmin";

/**
 * Orchestration between a provider adapter (pure, no database) and the
 * ingest layer (database, no provider knowledge). This is the "notify ->
 * authenticated fetch -> store" path the original webhook route documented
 * as deliberately unbuilt.
 */

/**
 * Fitbit documents a maximum of 100 notifications per delivery (it
 * aggregates updates within a short window into one message), so the cap is
 * 100 and not less — a smaller number would silently truncate a legitimate
 * full batch, which is data loss disguised as a successful ack. The cost is
 * bounded in practice because notifications are deduplicated by target
 * first: an aggregated batch is mostly repeats of the same
 * (collectionType, date) pair, and each distinct target is fetched once.
 */
const MAX_NOTIFICATIONS_PER_REQUEST = 100;

export interface SyncOutcome {
  connectionsTouched: number;
  vitalsInserted: number;
  wearableInserted: number;
  implausible: number;
  /** Accounts a webhook named that no active connection matches. Normal and
   * uninteresting on its own (a patient who disconnected, whose provider
   * hasn't stopped sending yet), but a persistently non-zero count means
   * external_id is being stored in a different shape than the webhook sends
   * it — the single most likely thing to be wrong on first real integration. */
  unmatchedAccounts: number;
  /** Readings dropped because the patient denied that category on the
   * connection, and (of those) the ones stored anyway because the metric
   * arms a red-flag classifier. Carried up rather than discarded at the
   * ingest boundary: a patient who has unknowingly narrowed a category
   * otherwise gets no signal anywhere that data is being dropped. */
  deniedByConsent: number;
  consentDeniedSafetyRetained: number;
  /** Rows a real database error rejected. Non-zero means this sync did not
   * store everything it was handed. */
  failed: number;
  /** The first storage failure's message, mirroring what was written to the
   * connection's last_sync_error. */
  syncError?: string;
  /** Set when the payload is a shape this platform recognises but cannot
   * process, so the webhook response says why instead of reporting a
   * successful zero. */
  unsupportedConfiguration?: string;
}

/**
 * Thrown by processWebhookPayload when a webhook batch did not fully store.
 *
 * The webhook route acks any authenticated payload on purpose, which is
 * right for a payload shape it does not recognise and wrong for a write that
 * failed: the provider's own redelivery is the recovery mechanism, and a
 * redelivery is free here because every reading dedupes on its external id.
 * Raising instead of returning is what stops `{ ok: true }` being sent over a
 * batch that never landed.
 */
export class WearableSyncError extends Error {
  readonly outcome: SyncOutcome;

  constructor(message: string, outcome: SyncOutcome) {
    super(message);
    this.name = "WearableSyncError";
    this.outcome = outcome;
  }
}

function emptyOutcome(): SyncOutcome {
  return {
    connectionsTouched: 0,
    vitalsInserted: 0,
    wearableInserted: 0,
    implausible: 0,
    unmatchedAccounts: 0,
    deniedByConsent: 0,
    consentDeniedSafetyRetained: 0,
    failed: 0,
  };
}

function accumulate(outcome: SyncOutcome, result: IngestResult): void {
  outcome.vitalsInserted += result.vitalsInserted;
  outcome.wearableInserted += result.wearableInserted;
  outcome.implausible += result.implausible;
  outcome.deniedByConsent += result.deniedByConsent;
  outcome.consentDeniedSafetyRetained += result.consentDeniedSafetyRetained;
  outcome.failed += result.failed;
}

/**
 * Ingest one connection's readings into `outcome`, recording rather than
 * raising a storage failure so the remaining connections in a batch are
 * still attempted. The failure is not lost: ingestFor has already written it
 * to the connection's last_sync_error, and outcome.failed is what makes
 * processWebhookPayload raise at the end.
 */
async function ingestInto(
  svc: SupabaseClient<Database>,
  outcome: SyncOutcome,
  connection: WearableConnectionCredentials,
  readings: NormalisedReading[]
): Promise<void> {
  try {
    accumulate(outcome, await ingestFor(svc, connection, readings));
  } catch (error) {
    if (!(error instanceof WearableIngestError)) throw error;
    accumulate(outcome, error.result);
    outcome.syncError ??= error.message;
  }
}

export async function processWebhookPayload(
  svc: SupabaseClient<Database>,
  provider: CloudOAuthWearableProvider,
  body: unknown
): Promise<SyncOutcome> {
  const adapter = PROVIDER_ADAPTERS[provider];
  const outcome = emptyOutcome();

  // Garmin registered as Ping/Pull rather than Push sends an account plus a
  // callbackURL instead of the summaries themselves. Both shapes are valid
  // JSON with the same top-level keys, so without this check a misregistered
  // integration is indistinguishable from a user with no data — it would ack
  // 200 forever and ingest nothing.
  if (provider === "garmin" && isGarminPingPullPayload(body)) {
    return { ...emptyOutcome(), unsupportedConfiguration: "garmin_ping_pull" };
  }

  // Inline push (Garmin): the summaries are already here, grouped per
  // account. No token needed — nothing is fetched.
  if (adapter.readInline) {
    for (const group of adapter.readInline(body)) {
      const connection = await resolveConnection(svc, provider, group.externalId);
      if (!connection) {
        outcome.unmatchedAccounts += 1;
        continue;
      }
      outcome.connectionsTouched += 1;
      await ingestInto(svc, outcome, connection, group.readings);
    }
    return raiseIfIncomplete(outcome);
  }

  if (!adapter.parseNotifications || !adapter.fetchForNotification) return outcome;

  // Notify-then-fetch. Two groupings, both load-bearing:
  //  - by target, because providers aggregate: Fitbit sends up to 100
  //    notifications in one delivery and many are the same
  //    (collectionType, date) pair, which would otherwise be the same
  //    authenticated GET repeated dozens of times inside one webhook.
  //  - by account, so a batch touching one patient resolves the connection
  //    and refreshes its token once rather than once per notification.
  const seenTargets = new Set<string>();
  const byAccount = new Map<string, ReturnType<NonNullable<typeof adapter.parseNotifications>>>();

  for (const notification of adapter.parseNotifications(body).slice(0, MAX_NOTIFICATIONS_PER_REQUEST)) {
    const fingerprint = `${notification.externalId}|${JSON.stringify(notification.target)}`;
    if (seenTargets.has(fingerprint)) continue;
    seenTargets.add(fingerprint);

    const existing = byAccount.get(notification.externalId);
    if (existing) existing.push(notification);
    else byAccount.set(notification.externalId, [notification]);
  }

  for (const [externalId, notifications] of byAccount) {
    const connection = await resolveConnection(svc, provider, externalId);
    if (!connection) {
      outcome.unmatchedAccounts += 1;
      continue;
    }

    const token = await getValidAccessToken(svc, connection);
    if (!token.ok) continue; // getValidAccessToken already recorded why.

    const readings: NormalisedReading[] = [];
    for (const notification of notifications) {
      readings.push(...(await adapter.fetchForNotification(token.accessToken, notification)));
    }

    outcome.connectionsTouched += 1;
    await ingestInto(svc, outcome, connection, readings);
  }

  return raiseIfIncomplete(outcome);
}

/**
 * The webhook path's last step. Every connection in the batch has been
 * attempted and its own last_sync_error written by now; this is what stops
 * the route replying `{ ok: true }` over a batch whose rows did not land.
 */
function raiseIfIncomplete(outcome: SyncOutcome): SyncOutcome {
  if (outcome.failed === 0) return outcome;
  throw new WearableSyncError(
    outcome.syncError ?? `Could not store ${outcome.failed} wearable reading(s)`,
    outcome
  );
}

/**
 * Pull-only providers (Dexcom) and backfill.
 *
 * `sync_cursor` is the high-water mark of data held, deliberately distinct
 * from last_synced_at (last contact of any kind, which a data-free webhook
 * ping also touches). It advances to the end of the window that was actually
 * requested, and the next run deliberately re-covers the last hour of it:
 * providers backfill readings slightly after the fact, and re-asking for an
 * overlap is free because every reading dedupes on its own id.
 */
export async function pullConnection(
  svc: SupabaseClient<Database>,
  connection: WearableConnectionCredentials,
  cursor: string | null
): Promise<SyncOutcome> {
  const adapter = PROVIDER_ADAPTERS[connection.provider];
  const outcome = emptyOutcome();
  if (!adapter.fetchSince) return outcome;

  const token = await getValidAccessToken(svc, connection);
  if (!token.ok) return outcome;

  const until = new Date();
  // Re-cover a short overlap on every run: a provider can backfill a reading
  // slightly after the fact, and the dedupe index makes an overlap free.
  const since = cursor
    ? new Date(Date.parse(cursor) - 60 * 60 * 1000)
    : new Date(until.getTime() - 7 * 24 * 3600_000);

  const readings = await adapter.fetchSince(token.accessToken, since, until);
  outcome.connectionsTouched = 1;
  try {
    accumulate(outcome, await ingestFor(svc, connection, readings, until.toISOString()));
  } catch (error) {
    if (!(error instanceof WearableIngestError)) throw error;
    // Deliberately does NOT raise, unlike the webhook path: the scheduled
    // sweep's documented contract is that failures are per-connection and
    // one bad connection does not stop the others. The failure is recorded
    // on the connection itself (last_sync_error) and in this outcome, and
    // ingestFor has already held sync_cursor back so the unstored window is
    // re-covered on the next run rather than skipped.
    accumulate(outcome, error.result);
    outcome.syncError = error.message;
  }
  return outcome;
}

async function ingestFor(
  svc: SupabaseClient<Database>,
  connection: WearableConnectionCredentials,
  readings: NormalisedReading[],
  cursor?: string
): Promise<IngestResult> {
  let result: IngestResult;
  let failure: WearableIngestError | null = null;
  try {
    result = await ingestReadings(
      svc,
      {
        connectionId: connection.id,
        organisationId: connection.organisation_id,
        patientId: connection.patient_id,
        consent: consentFromConnection(connection),
      },
      readings
    );
  } catch (error) {
    if (!(error instanceof WearableIngestError)) throw error;
    failure = error;
    result = error.result;
  }

  await svc
    .from("wearable_connections")
    .update({
      // Last contact of any kind, which a sync that failed to store still
      // was — so this advances either way.
      last_synced_at: new Date().toISOString(),
      // A failure is recorded, not erased. Unconditionally nulling this is
      // what let a batch containing a dangerous reading disappear behind a
      // clean-looking connection.
      last_sync_error: failure ? failure.message : null,
      // The cursor is the high-water mark of data actually HELD, so it may
      // only advance over a window that actually stored. Advancing past a
      // window whose rows failed would skip those readings permanently —
      // the next pull would start after readings that were never written.
      ...(cursor && !failure ? { sync_cursor: cursor } : {}),
    })
    .eq("id", connection.id);

  if (failure) throw failure;
  return result;
}

async function resolveConnection(
  svc: SupabaseClient<Database>,
  provider: CloudOAuthWearableProvider,
  externalId: string
): Promise<WearableConnectionCredentials | null> {
  // Ordered + limited rather than maybeSingle(): a duplicate active row for
  // one provider account would otherwise turn a real patient's whole sync
  // into an error instead of a reading. The 20260808023332 migration closed
  // the way a duplicate could be created, but resolution should not be the
  // thing that breaks if one exists from before.
  const { data } = await svc
    .from("wearable_connections")
    .select(WEARABLE_CREDENTIAL_COLUMNS)
    .eq("provider", provider)
    .eq("external_id", externalId)
    .eq("status", "active")
    .order("connected_at", { ascending: false })
    .limit(1);

  const row = data?.[0];
  if (!row) return null;
  return row as WearableConnectionCredentials;
}
