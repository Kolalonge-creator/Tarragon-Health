import { supabase } from "../supabase";
import { isNotOpen, searchArgs, type DirectoryRow, type ReportField, type SearchFilters } from "./model";

export type DirectoryResult = { ok: true; data: DirectoryRow[] } | { ok: false; notOpen: boolean };

/** Search the directory. The database hides stale listings and refuses (55000) while the go-live guard is off. */
export async function searchDirectory(filters: SearchFilters, now: Date = new Date()): Promise<DirectoryResult> {
  const { data, error } = await supabase.rpc("directory_search", searchArgs(filters, now.toISOString()));
  if (error) return { ok: false, notOpen: isNotOpen(error) };
  return { ok: true, data: data ?? [] };
}

/** Tell us a listing is wrong. A report never edits a listing: it queues it for a person to check again. */
export async function reportListing(input: { listingTable: string; listingId: string; field: ReportField; detail: string }): Promise<boolean> {
  const detail = input.detail.trim();
  const { error } = await supabase.rpc("report_directory_listing", {
    p_listing_table: input.listingTable,
    p_listing_id: input.listingId,
    p_field: input.field,
    ...(detail ? { p_detail: detail } : {}),
  });
  return error === null;
}
