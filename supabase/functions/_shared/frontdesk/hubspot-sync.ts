import type { HubspotClient } from "./hubspot.ts";

/** One CRM write the database says is due (service_fd_hubspot_claim). */
export interface ClaimedCrmRow {
  readonly outbox_id: string;
  readonly kind: "contact_upsert" | "note";
  readonly contact_id: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly name: string | null;
  readonly lifecycle_stage: string;
  readonly source: string;
  readonly hubspot_contact_id: string | null;
  readonly payload: { readonly body?: string } | null;
  readonly attempts: number;
}

export interface HubspotSyncDeps {
  readonly client: HubspotClient;
  readonly claim: (limit: number) => Promise<{ ok: true; rows: readonly ClaimedCrmRow[] } | { ok: false; error: string }>;
  readonly finish: (outboxId: string, ok: boolean, hubspotId: string | null, stage: string | null, sales: Record<string, string | null> | null, error: string | null) => Promise<void>;
  readonly batch?: number;
}

export interface HubspotSyncResult {
  readonly claimed: number;
  readonly sent: number;
  readonly failed: number;
  readonly unrecorded: number;
}

/**
 * Delivers the claimed CRM writes in order (upserts before notes). A note for a contact that has no HubSpot id yet upserts first, so it can never
 * be orphaned or create a duplicate. After a successful write the person's HubSpot-owned sales fields are read back and stored. Never throws.
 */
export async function syncToHubspot(deps: HubspotSyncDeps): Promise<HubspotSyncResult | { error: string }> {
  const claimed = await deps.claim(deps.batch ?? 20);
  if (!claimed.ok) return { error: claimed.error };
  let sent = 0;
  let failed = 0;
  let unrecorded = 0;
  // Within a batch, remember ids so two rows for one contact do not search twice.
  const ids = new Map<string, string>();
  for (const row of claimed.rows) {
    let delivered: { id: string; sales: Record<string, string | null> | null } | null = null;
    try {
      let id = row.hubspot_contact_id ?? ids.get(row.contact_id) ?? null;
      if (row.kind === "contact_upsert" || id === null) {
        const up = await deps.client.upsertContact({ email: row.email, phone: row.phone, name: row.name, stage: row.lifecycle_stage });
        if (!up.ok) {
          await deps.finish(row.outbox_id, false, null, null, null, `${up.error.code}: ${up.error.message}`);
          failed += 1;
          continue;
        }
        id = up.data;
        ids.set(row.contact_id, id);
      }
      if (row.kind === "note") {
        const note = await deps.client.addNote(id, row.payload?.body ?? "");
        if (!note.ok) {
          await deps.finish(row.outbox_id, false, id, null, null, `${note.error.code}: ${note.error.message}`);
          failed += 1;
          continue;
        }
      }
      // Reading the sales fields back is best effort: a failure here must not turn a delivered write into a failure.
      const sales = await deps.client.readSales(id);
      delivered = { id, sales: sales.ok ? { ...sales.data } : null };
      await deps.finish(row.outbox_id, true, id, row.kind === "contact_upsert" ? row.lifecycle_stage : null, delivered.sales, null);
      sent += 1;
    } catch (e) {
      if (delivered) {
        unrecorded += 1;
      } else {
        await deps.finish(row.outbox_id, false, null, null, null, e instanceof Error ? e.message : "unknown").catch(() => undefined);
        failed += 1;
      }
    }
  }
  return { claimed: claimed.rows.length, sent, failed, unrecorded };
}
