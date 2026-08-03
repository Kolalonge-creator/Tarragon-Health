import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type PanelBundle = Tables<"panel_bundles">;
export type LabProvider = Tables<"lab_providers">;

/** Active panel_bundles — the bookable unit (lab_orders has no per-test junction, only panel_bundle_id; a "single test" is just a one-item bundle). */
export function useLabCatalogue() {
  return useQuery({
    queryKey: ["lab-catalogue"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("panel_bundles")
        .select("*")
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (error) throw error;
      return data as PanelBundle[];
    },
  });
}

/**
 * The single-test bundle (test_codes = [code]) that fulfils a given
 * screen_type — this is what self-service "book this due screening" books,
 * per the clinician-originated-orders gate (the DB trigger requires an
 * exact match, this just finds the candidate for the UI).
 */
export function findSingleTestBundle(bundles: PanelBundle[], screenTypeCode: string) {
  return (
    bundles.find((b) => b.test_codes.length === 1 && b.test_codes[0] === screenTypeCode) ?? null
  );
}

/** Active lab_providers — the schema has no bundle->provider relationship, so this is every active provider, not a filtered "who offers this bundle" list. */
export function useLabProviders() {
  return useQuery({
    queryKey: ["lab-providers"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("lab_providers")
        .select("*")
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (error) throw error;
      return data as LabProvider[];
    },
  });
}

export type LabOrderWithDetails = Tables<"lab_orders"> & {
  panel_bundle: { name: string } | null;
  provider: { name: string; regions: string[] } | null;
  home_visit_provider: { name: string } | null;
  facility: { name: string } | null;
};

/**
 * provider.regions is included as a best-effort region signal for the
 * home-collection availability check on the patient's own order list —
 * there is no profiles.state/region column anywhere in this codebase, so
 * the already-chosen lab partner's own region is the closest proxy without
 * inventing a new stored field. The authoritative region for scheduling
 * itself is still whatever the assigning staff member manually selects
 * (same UX as /clinician/referrals), this is only used for the read-only
 * patient-facing availability hint.
 */
const LAB_ORDER_SELECT =
  "*, panel_bundle:panel_bundles!lab_orders_panel_bundle_id_fkey(name), provider:lab_providers!lab_orders_provider_id_fkey(name, regions), home_visit_provider:home_visit_providers!lab_orders_home_visit_provider_id_fkey(name), facility:facilities!lab_orders_facility_id_fkey(name)";

/** Patient's own lab_orders, newest first. RLS (patient_id = auth.uid()) does the scoping. */
export function usePatientLabOrders(patientId: string) {
  return useQuery({
    queryKey: ["lab-orders", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("lab_orders")
        .select(LAB_ORDER_SELECT)
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as LabOrderWithDetails[];
    },
    enabled: !!patientId,
  });
}

/**
 * All lab_orders in the caller's org, newest first — ops/clinician worklist
 * for assigning a home-visit provider + scheduled time. RLS
 * (private.is_org_staff) does the org-scoping.
 */
export function useOrgLabOrders() {
  return useQuery({
    queryKey: ["lab-orders", "org"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("lab_orders")
        .select(LAB_ORDER_SELECT)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as LabOrderWithDetails[];
    },
  });
}

/**
 * Patient issues a self-arranged order for a panel_bundle: Tarragon records
 * WHAT test is needed and why, and the patient takes it to whichever lab they
 * choose, pays that lab directly, and uploads the result. No provider, no
 * facility, no charge — private.enforce_lab_order_origin rejects all three on
 * a self_arranged order, so this is enforced server-side, not by convention.
 *
 * lab_orders' INSERT RLS allows patient_id = auth.uid() directly (unlike
 * specialist_referrals, which is always staff/trigger-created), so no server
 * action/service-role is needed for this step.
 *
 * Per the clinician-originated-orders gate (migration
 * 20260715125456_clinician_originated_orders), this only succeeds when
 * screeningScheduleId is a currently-due schedule this patient owns and
 * panelBundleId is that schedule's matching single-test bundle — the DB
 * trigger (private.enforce_lab_order_origin) re-checks both server-side,
 * this isn't just a client-side convention. The one schedule-free patient
 * path is a self_bookable bundle (the Annual Health Check, migration
 * 20260723150205): omit screeningScheduleId and the trigger allows it only
 * when panel_bundles.self_bookable is true for that bundle.
 */
export function useCreateLabOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      organisationId,
      patientId,
      panelBundleId,
      screeningScheduleId,
    }: {
      organisationId: string;
      patientId: string;
      panelBundleId: string;
      /** Required for the due-screening path; omitted only for self_bookable bundles. */
      screeningScheduleId?: string;
    }) => {
      const supabase = createClient();
      // Self-arranged: no provider, no facility, no charge, and it opens at
      // 'ordered' rather than 'pending_payment' because there is nothing for
      // Tarragon to collect. private.enforce_lab_order_origin rejects any of
      // those being set, so this shape is enforced server-side too.
      const { error } = await supabase.from("lab_orders").insert({
        organisation_id: organisationId,
        patient_id: patientId,
        panel_bundle_id: panelBundleId,
        total_kobo: 0,
        status: "ordered",
        screening_schedule_id: screeningScheduleId ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["lab-orders", variables.patientId] });
      queryClient.invalidateQueries({ queryKey: ["screening-schedules", variables.patientId] });
    },
  });
}

/**
 * Clinician generates an ad hoc lab order for a patient (any catalogue
 * bundle, not just a due screening) — the clinician-originated-orders
 * counterpart to useCreateLabOrder's due-screening self-service path.
 * origin='clinically_triggered' + ordered_by set to the caller's own
 * clinical_staff row is what private.enforce_lab_order_origin requires;
 * this fails closed (throws) if the caller has no active clinical_staff
 * record in this organisation, same shape as useVerifyClinicalStaff's
 * auth.getUser() check.
 */
export function useOrderLabTest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      organisationId,
      patientId,
      panelBundleId,
    }: {
      organisationId: string;
      patientId: string;
      panelBundleId: string;
    }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { data: staff, error: staffError } = await supabase
        .from("clinical_staff")
        .select("id")
        .eq("profile_id", user.id)
        .eq("organisation_id", organisationId)
        .eq("active", true)
        .maybeSingle();
      if (staffError) throw staffError;
      if (!staff) {
        throw new Error("You must be an active clinical_staff member of this organisation to order a lab test");
      }

      // Self-arranged, exactly like the patient path: the clinician decides
      // WHAT test is needed and why; the patient takes that order to whichever
      // lab suits them and uploads the result.
      const { error } = await supabase.from("lab_orders").insert({
        organisation_id: organisationId,
        patient_id: patientId,
        panel_bundle_id: panelBundleId,
        total_kobo: 0,
        status: "ordered",
        origin: "clinically_triggered",
        ordered_by: staff.id,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["lab-orders", variables.patientId] });
    },
  });
}

/* useSetLabOrderFacility and its ChooseLabFacility card are removed: a
 * self-arranged order has no facility to set, and public.set_lab_order_facility
 * now refuses one outright. The RPC survives for the dormant partner path. */

export type LabResultInterpretation = Tables<"lab_result_interpretations">;

/** Patient's own lab result interpretations, newest first. */
export function usePatientLabResults(patientId: string) {
  return useQuery({
    queryKey: ["lab-results", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("lab_result_interpretations")
        .select("*")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as LabResultInterpretation[];
    },
    enabled: !!patientId,
  });
}
