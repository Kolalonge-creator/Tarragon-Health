import type { NormalisedReading } from "../normalise";

/**
 * Every provider does one of three things, and the adapter interface names
 * all three rather than pretending they're the same:
 *
 *  - notify-then-fetch (Fitbit, WHOOP, Oura): the webhook body says *what
 *    changed* and nothing else. The reading only exists behind an
 *    authenticated GET made with the stored access token. This was the half
 *    the original webhook route documented as unbuilt.
 *  - inline push (Garmin): the webhook body carries the summaries outright,
 *    so there is nothing to fetch.
 *  - pull-only (Dexcom): no webhook mechanism exists at all; a scheduled job
 *    asks for a window.
 *
 * Adapters are pure: they take a payload or an access token and return
 * normalised readings. Nothing here touches the database.
 */

/** A fetch instruction derived from one webhook notification. */
export interface WebhookNotification {
  /** The provider's own account identifier, matched against
   * wearable_connections.external_id to find whose connection this is. */
  externalId: string;
  /** Which document/collection to go and read. Provider-specific. */
  target: Record<string, string>;
}

/** Readings that arrived already attached to an account, with no fetch. */
export interface InlineReadingGroup {
  externalId: string;
  readings: NormalisedReading[];
}

export interface ProviderAdapter {
  /** Notify-then-fetch: split the webhook body into fetch instructions. */
  parseNotifications?(body: unknown): WebhookNotification[];
  /** Notify-then-fetch: perform the authenticated follow-up read. */
  fetchForNotification?(
    accessToken: string,
    notification: WebhookNotification
  ): Promise<NormalisedReading[]>;
  /** Inline push: readings are already in the body. */
  readInline?(body: unknown): InlineReadingGroup[];
  /** Pull-only / backfill: everything recorded in a window. */
  fetchSince?(accessToken: string, since: Date, until: Date): Promise<NormalisedReading[]>;
}
