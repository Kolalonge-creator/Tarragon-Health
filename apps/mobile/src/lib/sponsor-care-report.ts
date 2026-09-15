import { supabase } from "./supabase";
import type { QueryResult } from "./medications";
import type { Enums } from "@tarragon/shared";

/**
 * Mirrors apps/web/src/lib/queries/sponsor-care-report.ts. The standing rule
 * behind this RPC is the design, not a constraint on it: a sponsor sees THAT
 * they paid and THAT it was used, and nothing about results, unless the
 * patient has explicitly raised sharing beyond 'none'. Even at the most
 * generous level the RPC returns no clinical VALUE — no blood pressure
 * figure, no glucose figure, no diagnosis, no medicine.
 */
export type SponsorCareReport = {
  sharing_level: Enums<"sponsor_sharing_level">;
  since?: string;
  vouchers: {
    voucher_number: string;
    what: string | null;
    paid_kobo: number;
    status: string;
    activated_at: string | null;
    redeemed_at: string | null;
  }[];
  readings_logged?: number;
  last_clinical_review?: string | null;
  next_check_due?: string | null;
  monitoring_active_until?: string | null;
  note: string;
};

export async function loadSponsorCareReport(beneficiaryId: string): Promise<QueryResult<SponsorCareReport>> {
  const { data, error } = await supabase.rpc("sponsor_care_report", { p_beneficiary: beneficiaryId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as unknown as SponsorCareReport };
}

export interface SponsorSharingPreference {
  id: string;
  sponsor_id: string;
  level: Enums<"sponsor_sharing_level">;
  sponsor: { full_name: string | null } | null;
}

/** What each of my sponsors may see about me. Absent row means 'none'. */
export async function loadMySponsorSharing(): Promise<QueryResult<SponsorSharingPreference[]>> {
  const { data, error } = await supabase
    .from("sponsor_sharing_preferences")
    .select("id, sponsor_id, level, sponsor:profiles!sponsor_sharing_preferences_sponsor_id_fkey(full_name)");
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as unknown as SponsorSharingPreference[] };
}

/**
 * patient_id comes from the session, never from a param: this is the row
 * that decides who may see someone's health activity, and it must not be
 * settable for anyone but yourself. The RLS policy enforces the same thing,
 * so this is defence in depth rather than the only check.
 */
export async function setSponsorSharing(input: {
  organisationId: string;
  sponsorId: string;
  level: Enums<"sponsor_sharing_level">;
}): Promise<QueryResult<null>> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { error } = await supabase.from("sponsor_sharing_preferences").upsert(
    {
      organisation_id: input.organisationId,
      patient_id: user.id,
      sponsor_id: input.sponsorId,
      level: input.level,
      decided_at: new Date().toISOString(),
    },
    { onConflict: "patient_id,sponsor_id" }
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}
