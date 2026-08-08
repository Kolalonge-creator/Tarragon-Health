import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import {
  getValidAccessToken,
  WEARABLE_CREDENTIAL_COLUMNS,
  type WearableConnectionCredentials,
} from "./connection-tokens";
import { ingestReadings, type IngestResult } from "./ingest";
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
  /** Set when the payload is a shape this platform recognises but cannot
   * process, so the webhook response says why instead of reporting a
   * successful zero. */
  unsupportedConfiguration?: string;
}

function emptyOutcome(): SyncOutcome {
  return {
    connectionsTouched: 0,
    vitalsInserted: 0,
    wearableInserted: 0,
    implausible: 0,
    unmatchedAccounts: 0,
  };
}

function accumulate(outcome: SyncOutcome, result: IngestResult): void {
  outcome.vitalsInserted += result.vitalsInserted;
  outcome.wearableInserted += result.wearableInserted;
  outcome.implausible += result.implausible;
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
      accumulate(outcome, await ingestFor(svc, connection, group.readings));
    }
    return outcome;
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
    accumulate(outcome, await ingestFor(svc, connection, readings));
  }

  return outcome;
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
  accumulate(outcome, await ingestFor(svc, connection, readings, until.toISOString()));
  return outcome;
}

async function ingestFor(
  svc: SupabaseClient<Database>,
  connection: WearableConnectionCredentials,
  readings: NormalisedReading[],
  cursor?: string
): Promise<IngestResult> {
  const result = await ingestReadings(
    svc,
    {
      connectionId: connection.id,
      organisationId: connection.organisation_id,
      patientId: connection.patient_id,
    },
    readings
  );

  await svc
    .from("wearable_connections")
    .update({
      last_synced_at: new Date().toISOString(),
      last_sync_error: null,
      ...(cursor ? { sync_cursor: cursor } : {}),
    })
    .eq("id", connection.id);

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
