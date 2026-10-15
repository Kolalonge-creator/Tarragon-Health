import type { Json } from "@tarragon/shared";
import { describeLabError, resultEntrySchema, toPanelUnits, type PanelCode, type ResultEntryItem } from "@/lib/lab-results/structured";

/**
 * S74 (spec 21.1): where a laboratory's results come from. One interface, two implementations.
 *
 *  - ManualEntryLabResultsSource: a partner laboratory types values in the portal (what runs today).
 *  - ApiLabResultsSource: the seam for a laboratory that can push results by API (SYNLAB, when it can). It is a STUB. It calls nothing,
 *    never throws, and always answers "not connected" until an adapter is written against that laboratory's real documentation.
 *
 * Whichever source is used, the database decides everything that matters: the order must be this laboratory's own (the cross-lab refusal is
 * a database rule, not a rule of this file), units and ranges are fixed by the panel, and an abnormal or sensitive result is held for a
 * clinician (INV-03, INV-04). A source can only hand over values; it can never release a result.
 *
 * Home test kits are NOT built here. Documenting the seam only: a kit would be one more way an order's sample arrives, with results still entering
 * through a LabResultsSource; it needs a named partner and a D-06 treatment first (OQ-361).
 */
export type LabResultsSourceKind = "manual_entry" | "api";

export interface LabResultsSubmission {
  orderId: string;
  panel: PanelCode;
  items: ResultEntryItem[];
  /** A report already stored in the private bucket; produced by the caller, never by a source. */
  file?: { file_path: string; original_filename: string; mime_type: string; file_size_bytes: number } | null;
}

export type LabResultsRefusal = "invalid_input" | "not_this_labs_order" | "already_received" | "not_connected" | "failed";

export type LabResultsOutcome =
  | { ok: true; labResultId: string | null; releaseState: string | null }
  | { ok: false; reason: LabResultsRefusal; message: string };

export interface LabResultsSource {
  readonly kind: LabResultsSourceKind;
  /** The value `lab_results.source` carries for results that arrive through this source. */
  readonly databaseSource: "portal_entry" | "api";
  isConfigured(): boolean;
  submit(submission: LabResultsSubmission): Promise<LabResultsOutcome>;
}

/** The only part of the Supabase client a source needs. */
export interface RpcClient {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

/** Maps a database error to a refusal the caller can act on. The cross-lab message is the database's own, verbatim. */
export function refusalFromError(error: { message: string; code?: string }): { reason: LabResultsRefusal; message: string } {
  if (error.message.includes("Order not found for this lab")) return { reason: "not_this_labs_order", message: describeLabError(error) };
  if (error.message.includes("lab_result_already_received")) return { reason: "already_received", message: describeLabError(error) };
  return { reason: "failed", message: describeLabError(error) };
}

export class ManualEntryLabResultsSource implements LabResultsSource {
  readonly kind = "manual_entry" as const;
  readonly databaseSource = "portal_entry" as const;
  constructor(private readonly client: RpcClient) {}

  isConfigured(): boolean {
    return true;
  }

  async submit(s: LabResultsSubmission): Promise<LabResultsOutcome> {
    const parsed = resultEntrySchema.safeParse({ orderId: s.orderId, panel: s.panel, items: s.items });
    if (!parsed.success) return { ok: false, reason: "invalid_input", message: parsed.error.issues[0]?.message ?? "Please check the values." };
    const converted = toPanelUnits(parsed.data.items);
    if ("error" in converted) return { ok: false, reason: "invalid_input", message: converted.error };
    const { data, error } = await this.client.rpc("lab_partner_submit_result", {
      p_order: parsed.data.orderId,
      p_panel: parsed.data.panel,
      p_items: converted.items as unknown as Json,
      p_file: (s.file ?? undefined) as unknown as Json,
    });
    if (error) return { ok: false, ...refusalFromError(error) };
    const row = data && typeof data === "object" ? (data as { lab_result_id?: unknown; release_state?: unknown }) : {};
    return {
      ok: true,
      labResultId: typeof row.lab_result_id === "string" ? row.lab_result_id : null,
      releaseState: typeof row.release_state === "string" ? row.release_state : null,
    };
  }
}

export interface ApiLabResultsConfig {
  /** Present only once a laboratory has agreed an integration; nothing reads these yet. */
  baseUrl?: string;
  credentialRef?: string;
}

/** A placeholder for a laboratory API. Honest about what it is: it connects to nothing. */
export class ApiLabResultsSource implements LabResultsSource {
  readonly kind = "api" as const;
  readonly databaseSource = "api" as const;
  constructor(readonly config: ApiLabResultsConfig = {}) {}

  isConfigured(): boolean {
    return false;
  }

  async submit(): Promise<LabResultsOutcome> {
    return { ok: false, reason: "not_connected", message: "No laboratory API is connected yet. Results are entered in the portal." };
  }
}

export function getLabResultsSource(kind: LabResultsSourceKind, client: RpcClient, apiConfig?: ApiLabResultsConfig): LabResultsSource {
  return kind === "api" ? new ApiLabResultsSource(apiConfig) : new ManualEntryLabResultsSource(client);
}
