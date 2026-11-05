"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { searchDiagnosticServices, type SearchResult } from "./search";

/**
 * Diagnostic directory Phase 5: a doctor suggests where the patient can have an ordered test done, and the patient opens it.
 * The database (clinician_suggest_place / order_suggested_place) checks who may act, that the branch is recommendable for the
 * test at that moment, and stamps the patient's first view. A suggestion is advice only: it changes nothing on the order, and
 * the patient may go anywhere.
 */
const uuid = z.string().uuid();
const kind = z.enum(["lab", "imaging"]);

const placeSchema = z.object({
  suggestion_id: uuid, kind, test: z.string(), provider_name: z.string(), branch_name: z.string(), address: z.string(),
  town: z.string().nullable(), lga: z.string().nullable(), state: z.string(), phone: z.string().nullable(),
  latitude: z.number().nullable(), longitude: z.number().nullable(), appointment_required: z.boolean().nullable(),
  preparation_note: z.string().nullable(), still_recommendable: z.boolean(), is_partner: z.boolean(),
  suggested_at: z.string(), suggested_by: z.string().nullable(), viewed_at: z.string().nullable(),
});
export type SuggestedPlace = z.infer<typeof placeSchema>;
export type PlaceRead = { ok: true; place: SuggestedPlace | null } | { ok: false };

async function readPlace(k: "lab" | "imaging", orderId: string): Promise<PlaceRead> {
  const { data, error } = await loose(await createClient()).rpc("order_suggested_place", { p_kind: k, p_order_id: orderId });
  if (error) return { ok: false };
  if (data === null) return { ok: true, place: null };
  const parsed = placeSchema.safeParse(data);
  return parsed.success ? { ok: true, place: parsed.data } : { ok: false };
}

/** Patient: open the suggestion for one order. The first call records that the patient has seen it. */
export async function openSuggestedPlaceAction(input: { kind: string; orderId: string }): Promise<PlaceRead> {
  const p = z.object({ kind, orderId: uuid }).safeParse(input);
  if (!p.success) return { ok: false };
  return readPlace(p.data.kind, p.data.orderId);
}

/** Staff: read a suggestion without marking it seen (only the patient's own read stamps it). */
export async function loadSuggestedPlace(k: "lab" | "imaging", orderId: string): Promise<PlaceRead> {
  return readPlace(k, orderId);
}

const findSchema = z.object({
  patientId: uuid, conceptId: uuid,
  state: z.string().trim().min(2).max(60), lga: z.string().trim().max(80).optional(),
});

/** Clinician: branches that do this test in the PATIENT's state/LGA (design §9: never the doctor's own location). */
export async function findPlacesAction(input: z.input<typeof findSchema>): Promise<SearchResult> {
  const p = findSchema.safeParse(input);
  if (!p.success) return { ok: false, reason: "invalid" };
  return searchDiagnosticServices({
    conceptId: p.data.conceptId,
    location: { state: p.data.state, lga: p.data.lga && p.data.lga.length >= 2 ? p.data.lga : undefined },
    includeUnconfirmed: false,
  });
}

export type SuggestResult = { ok: true } | { ok: false; reason: "denied" | "not_recommendable" | "invalid" | "failed" };

const suggestSchema = z.object({ kind, orderId: uuid, patientId: uuid, branchListingId: uuid, conceptId: uuid });

export async function suggestPlaceAction(input: z.input<typeof suggestSchema>): Promise<SuggestResult> {
  const p = suggestSchema.safeParse(input);
  if (!p.success) return { ok: false, reason: "invalid" };
  const { error } = await loose(await createClient()).rpc("clinician_suggest_place", {
    p_kind: p.data.kind, p_order_id: p.data.orderId, p_branch_listing_id: p.data.branchListingId, p_concept_id: p.data.conceptId,
  });
  if (error) {
    return { ok: false, reason: error.code === "42501" ? "denied" : error.code === "23514" ? "not_recommendable" : error.code === "22023" ? "invalid" : "failed" };
  }
  revalidatePath(`/clinician/patients/${p.data.patientId}`);
  return { ok: true };
}

const withdrawSchema = z.object({ suggestionId: uuid, patientId: uuid, reason: z.string().trim().min(5).max(300) });

export async function withdrawPlaceAction(input: z.input<typeof withdrawSchema>): Promise<SuggestResult> {
  const p = withdrawSchema.safeParse(input);
  if (!p.success) return { ok: false, reason: "invalid" };
  const { error } = await loose(await createClient()).rpc("clinician_withdraw_place", { p_suggestion_id: p.data.suggestionId, p_reason: p.data.reason });
  if (error) return { ok: false, reason: error.code === "42501" ? "denied" : "failed" };
  revalidatePath(`/clinician/patients/${p.data.patientId}`);
  return { ok: true };
}
