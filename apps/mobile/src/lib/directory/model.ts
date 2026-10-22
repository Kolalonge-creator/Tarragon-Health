/**
 * Pure helpers for the phone's directory screen (S65). The same rules as apps/web/src/lib/directory/model.ts, kept in step by
 * model.test.ts, minus the two things a phone cannot do without a new native build: there is no "near me" (it needs expo-location) and
 * no browser user-agent sniffing (Platform.OS decides which maps link to build).
 */
import type { Database } from "@tarragon/shared";
import type { MessageKey } from "@tarragon/i18n";

export type DirectoryRow = Database["public"]["Functions"]["directory_search"]["Returns"][number];
export type DirectoryArgs = Database["public"]["Functions"]["directory_search"]["Args"];

export const REPORT_FIELDS = ["phone", "address", "hours", "closed", "services", "other"] as const;
export type ReportField = (typeof REPORT_FIELDS)[number];

export const TIER_KEY: Readonly<Record<string, MessageKey>> = {
  seed_only: "directory.tier.seed_only",
  phone_confirmed: "directory.tier.phone_confirmed",
  licence_checked: "directory.tier.licence_checked",
};

/** An unknown tier reads as the weakest one, never as a stronger one. */
export function tierKey(tier: string): MessageKey {
  return TIER_KEY[tier] ?? "directory.tier.seed_only";
}

export function hmoKey(status: string | null): MessageKey | null {
  return status === "confirmed" ? "directory.hmo.confirmed" : status === "claimed" ? "directory.hmo.claimed" : null;
}

export function nhiaKey(status: string | null): MessageKey | null {
  return status === "confirmed" ? "directory.nhia.confirmed" : status === "claimed" ? "directory.nhia.claimed" : null;
}

/** Whole naira from integer kobo (INV-15). Never shows a price that is not there. */
export function nairaFromKobo(kobo: number | null | undefined): string | null {
  if (typeof kobo !== "number" || !Number.isFinite(kobo) || kobo < 0) return null;
  return `₦${Math.round(kobo / 100).toLocaleString("en-NG")}`;
}

export interface SearchFilters {
  readonly state: string;
  readonly service: string;
  readonly language: string;
  readonly hmo: string;
  readonly nhia: boolean;
  readonly openNow: boolean;
}

export const EMPTY_FILTERS: SearchFilters = { state: "", service: "", language: "", hmo: "", nhia: false, openNow: false };

/** Empty boxes send nothing, so an untouched filter never narrows the search by accident. */
export function searchArgs(f: SearchFilters, nowIso: string): DirectoryArgs {
  const args: DirectoryArgs = { p_limit: 50 };
  if (f.state.trim()) args.p_state = f.state.trim();
  if (f.service.trim()) args.p_service = f.service.trim();
  if (f.language.trim()) args.p_language = f.language.trim();
  if (f.hmo.trim()) args.p_hmo = f.hmo.trim();
  if (f.nhia) args.p_nhia = true;
  if (f.openNow) args.p_open_at = nowIso;
  return args;
}

/** The RPC answers 55000 while the go-live guard is off; the screen shows a calm "not open yet" instead of an error. */
export function isNotOpen(error: { code?: string } | null | undefined): boolean {
  return error?.code === "55000";
}
