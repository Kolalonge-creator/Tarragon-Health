import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PROPOSED_CONFIG } from "@tarragon/shared";
import type { Database } from "@tarragon/shared";
import { buildConfigRows, lagosToday, openRows, type ConfigRow } from "@/lib/go-live/model";
import { loadSignoffs, type RpcClient } from "@/lib/go-live/load";
import type { SignoffQueueItem } from "@/lib/queries/signoff-queue";

/** The hub line for CMO-owned patient-harm registry values that are confirmed on the hub itself (not S06 to S10, which has its own line). */
export const CLINICAL_PROPOSED_ITEM_KEY = "proposed_values_clinical";

/**
 * Registry values the Chief Medical Officer owns whose confirmation IS the clinical signature (CLAUDE.md: anything the CMO must sign
 * belongs on the hub, never only on its own page). Add a key here when a new patient-harm value is confirmed through the registry.
 */
export const CLINICAL_PROPOSED_KEYS = [
  // CDE-09 / OQ-CDE-11: the narrative urgent-finding rules and their paging tiers. Nothing applies them until confirmed.
  "documents.narrative_urgent_rules",
] as const;

export type PendingClinicalProposedValues = { rows: ConfigRow[]; item: SignoffQueueItem | null; failed: boolean };

/** Never throws: an unreadable sign-off list is reported as failed, never as "nothing waiting". */
export async function readPendingClinicalProposedValues(supabase: SupabaseClient<Database>): Promise<PendingClinicalProposedValues> {
  const signoffs = await loadSignoffs(supabase as unknown as RpcClient).catch(() => ({ ok: false as const }));
  if (!signoffs.ok) return { rows: [], item: null, failed: true };
  const wanted = new Set<string>(CLINICAL_PROPOSED_KEYS);
  const rows = openRows(buildConfigRows(PROPOSED_CONFIG.filter((e) => wanted.has(e.key)), signoffs.data, lagosToday()));
  if (rows.length === 0) return { rows, item: null, failed: false };
  return {
    rows,
    failed: false,
    item: {
      key: CLINICAL_PROPOSED_ITEM_KEY,
      title: rows.length === 1 && rows[0].key === "documents.narrative_urgent_rules" ? "Narrative urgent-finding rules" : "Clinical values waiting to be confirmed",
      detail:
        "Which printed findings on a scan, ECG, pathology or cervical report make the doctor review urgent, the 500 ms QTc line, and which tier of the escalation ladder each match pages at, as you decided in chat on 4 November 2026. Nothing applies these rules until you confirm the exact value shown.",
      href: "/clinician/go-live#proposed-values",
      severity: "draft_pending",
      count: rows.length,
    },
  };
}
