import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/**
 * list_lab_test_locations's return shape, extended 2026-09-24 with
 * avg_rating/review_count (20260924210135_lab_location_reviews.sql) — not
 * yet reflected in the generated Database type (packages/shared regenerates
 * against every in-flight branch's live project; this session has no
 * credentials to run that and, per the standing "splice in only what your
 * own migrations added" lesson, a full regeneration risks importing
 * unrelated unmerged schema), so extended locally the same way
 * ScreenTypeCatalogueFields and other ahead-of-codegen shapes already are
 * in lab-orders.ts. Regenerate and fold this into the real RPC return type
 * next time codegen runs.
 */
export type LabTestLocation = {
  provider_id: string;
  provider_name: string;
  integration_status: string;
  accreditation: string | null;
  location_id: string;
  location_name: string;
  location_state: string;
  location_address: string;
  contact_phone: string | null;
  opening_hours: unknown;
  capabilities: string[];
  turnaround_hours: number | null;
  price_kobo: number | null;
  /** Rounded to 1dp over visible reviews only; null when the branch has none yet. */
  avg_rating: number | null;
  review_count: number;
};

/** Active lab branches offering a given test (or every active branch with no code), each carrying its aggregate patient rating. Backs the lab directory. */
export function useLabTestLocations(testCode?: string | null, state?: string | null) {
  return useQuery({
    queryKey: ["lab-test-locations", testCode ?? null, state ?? null],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("list_lab_test_locations", {
        p_test_code: testCode ?? undefined,
        p_state: state ?? undefined,
      });
      if (error) throw error;
      return (data ?? []) as LabTestLocation[];
    },
  });
}

export type LabLocationReviewListItem = {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
};

/**
 * The public, identity-free directory read for one branch — rating/comment/
 * created_at only, never which patient wrote it. Any authenticated user can
 * call this even though the raw lab_location_reviews table restricts SELECT
 * to the review's own author and staff (see the migration's own comment).
 */
export function useLabLocationReviews(locationId: string | null | undefined, limit = 20) {
  return useQuery({
    queryKey: ["lab-location-reviews", locationId, limit],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("list_lab_location_reviews", {
        p_location_id: locationId as string,
        p_limit: limit,
      });
      if (error) throw error;
      return (data ?? []) as LabLocationReviewListItem[];
    },
    enabled: !!locationId,
  });
}

export type MyLabLocationReview = {
  id: string;
  rating: number;
  comment: string | null;
  status: "visible" | "hidden";
  created_at: string;
};

/** The caller's own review of a specific completed order, if they've already filed one — drives "rate this lab" vs. "you rated this X" in the order list. */
export function useMyLabLocationReview(labOrderId: string | null | undefined) {
  return useQuery({
    queryKey: ["lab-location-review-mine", labOrderId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("lab_location_reviews")
        .select("id, rating, comment, status, created_at")
        .eq("lab_order_id", labOrderId as string)
        .maybeSingle();
      if (error) throw error;
      return data as MyLabLocationReview | null;
    },
    enabled: !!labOrderId,
  });
}

/**
 * Records which lab_provider_locations branch the patient used for their
 * own self-arranged order, via the SECURITY DEFINER set_lab_order_location
 * RPC (lab_orders_update RLS is staff-only, so this can't be a plain table
 * update). Callable any time before or after the result lands; a review can
 * only be filed once this matches a 'resulted' order.
 */
export function useSetLabOrderLocation(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId, locationId }: { orderId: string; locationId: string | null }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("set_lab_order_location", {
        p_order_id: orderId,
        p_location_id: locationId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lab-orders", patientId] });
    },
  });
}

/**
 * Patient rates the lab branch they used for a completed order. RLS's own
 * verification gate (lab_location_reviews_insert) is the real enforcement —
 * a real, completed, own order whose location matches — this mutation just
 * surfaces that as a normal Supabase error if the gate refuses it.
 */
export function useSubmitLabLocationReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      organisationId,
      patientId,
      labOrderId,
      locationId,
      rating,
      comment,
    }: {
      organisationId: string;
      patientId: string;
      labOrderId: string;
      locationId: string;
      rating: number;
      comment?: string | null;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("lab_location_reviews").insert({
        organisation_id: organisationId,
        patient_id: patientId,
        lab_order_id: labOrderId,
        location_id: locationId,
        rating,
        comment: comment?.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["lab-location-review-mine", variables.labOrderId] });
      queryClient.invalidateQueries({ queryKey: ["lab-location-reviews", variables.locationId] });
      queryClient.invalidateQueries({ queryKey: ["lab-test-locations"] });
    },
  });
}

/** Flags a currently-visible review for staff moderation. Never exposes who else flagged the same review, and a duplicate flag from the same reporter is silently absorbed — see report_lab_location_review's own comment. */
export function useReportLabLocationReview() {
  return useMutation({
    mutationFn: async ({ reviewId, reason }: { reviewId: string; reason: string }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("report_lab_location_review", {
        p_review_id: reviewId,
        p_reason: reason,
      });
      if (error) throw error;
    },
  });
}
