"use server";

import { z } from "zod";
import { getProposedConfig } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { searchDiagnosticServices, type SearchResult } from "./search";

/**
 * Diagnostic directory Phase 6: what the patient search page calls. Finding the test uses the Phase 1 catalogue search with
 * its versioned threshold; finding a place uses search_diagnostic_services (eligibility, partner band and labelling are all
 * decided in the database). A failure is reported as a failure, never as "nothing found".
 */
const testRowSchema = z.object({
  concept_id: z.string().uuid(), display: z.string(), patient_description: z.string().nullable(),
  investigation_category: z.string().nullable(), matched_on: z.string(),
  clarifies_concept_id: z.string().uuid().nullable(), clarifies_display: z.string().nullable(),
});
export type TestMatch = z.infer<typeof testRowSchema>;
export type FindTests = { ok: true; matches: TestMatch[]; clarifying: string | null } | { ok: false };

export async function findTestsAction(text: string): Promise<FindTests> {
  const q = z.string().trim().min(2).max(80).safeParse(text);
  if (!q.success) return { ok: false };
  const minScore = getProposedConfig<{ min_score: number }>("directory.investigation_search").value.min_score;
  const { data, error } = await loose(await createClient()).rpc("search_investigations", { p_text: q.data, p_min_score: minScore, p_limit: 8 });
  if (error) return { ok: false };
  const rows = z.array(testRowSchema).safeParse(data ?? []);
  if (!rows.success) return { ok: false };
  const clarify = rows.data.find((r) => r.matched_on === "clarify");
  return { ok: true, matches: rows.data, clarifying: clarify?.clarifies_display ?? null };
}

const placeSchema = z.object({
  conceptId: z.string().uuid(),
  where: z.union([
    z.object({ lat: z.number(), lng: z.number(), radiusKm: z.number().positive() }),
    z.object({ state: z.string().trim().min(2).max(60), lga: z.string().trim().max(80).optional() }),
  ]),
  page: z.number().int().min(0).max(100).default(0),
});

export async function findPlacesForPatientAction(input: z.input<typeof placeSchema>): Promise<SearchResult> {
  const p = placeSchema.safeParse(input);
  if (!p.success) return { ok: false, reason: "invalid" };
  const where = p.data.where;
  return searchDiagnosticServices({
    conceptId: p.data.conceptId,
    location: "lat" in where ? where : { state: where.state, lga: where.lga && where.lga.length >= 2 ? where.lga : undefined },
    // §10: otherwise-verified branches still awaiting confirmation are shown, labelled, below every eligible one.
    includeUnconfirmed: true,
    page: p.data.page,
  });
}

const profileSchema = z.object({
  branch_listing_id: z.string().uuid(), kind: z.enum(["lab", "imaging"]), provider_name: z.string(), branch_name: z.string(),
  address: z.string(), neighbourhood: z.string().nullable(), town: z.string().nullable(), lga: z.string().nullable(), state: z.string(),
  phone: z.string().nullable(), email: z.string().nullable(), website: z.string().nullable(),
  latitude: z.number().nullable(), longitude: z.number().nullable(), location_checked_on: z.string().nullable(), is_partner: z.boolean(),
  services: z.array(z.object({
    concept_id: z.string().uuid(), test: z.string(), availability: z.string(), appointment_required: z.boolean(),
    preparation_note: z.string().nullable(), performed_elsewhere: z.boolean(),
  })),
});
export type BranchProfile = z.infer<typeof profileSchema>;

export async function loadBranchProfile(id: string): Promise<{ ok: true; profile: BranchProfile | null } | { ok: false; closed: boolean }> {
  if (!z.string().uuid().safeParse(id).success) return { ok: true, profile: null };
  const { data, error } = await loose(await createClient()).rpc("diagnostic_branch_profile", { p_branch_listing_id: id });
  if (error) return { ok: false, closed: error.code === "55000" };
  if (data === null) return { ok: true, profile: null };
  const parsed = profileSchema.safeParse(data);
  return parsed.success ? { ok: true, profile: parsed.data } : { ok: false, closed: false };
}
