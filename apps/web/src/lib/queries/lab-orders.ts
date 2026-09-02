import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Database, Tables } from "@tarragon/shared";

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

/**
 * screen_types.price_kobo, keyed by code — the authoritative signal for
 * whether a specific test is covered by the active contracted partner
 * (Synlab). The 2026-08-21 pricing migration nulls this out for any test
 * without a real contract price, so "every code in a bundle has a price
 * here" is a reliable enough client-side check for whether that bundle can
 * be billed through the partner path, without duplicating
 * private.compute_partner_cost's logic.
 */
export function useScreenTypePrices() {
  return useQuery({
    queryKey: ["screen-type-prices"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.from("screen_types").select("code, price_kobo");
      if (error) throw error;
      return new Map((data ?? []).map((row) => [row.code, row.price_kobo]));
    },
  });
}

/** True only when every test in the bundle has a contracted partner price on file. */
export function bundleIsPartnerBillable(
  bundle: Pick<PanelBundle, "test_codes">,
  prices: Map<string, number | null> | undefined
): boolean {
  if (!prices || bundle.test_codes.length === 0) return false;
  return bundle.test_codes.every((code) => !!prices.get(code));
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
  // test_codes drives, e.g., whether this order needs the ECG-specific
  // uploader alongside (not instead of — a bundle can mix ecg_resting with
  // blood tests) the generic PatientResultUpload, since an ECG is a separate
  // physical document from a lab panel's combined PDF.
  panel_bundle: { name: string; test_codes: string[] } | null;
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
  "*, panel_bundle:panel_bundles!lab_orders_panel_bundle_id_fkey(name, test_codes), provider:lab_providers!lab_orders_provider_id_fkey(name, regions), home_visit_provider:home_visit_providers!lab_orders_home_visit_provider_id_fkey(name), facility:facilities!lab_orders_facility_id_fkey(name)";

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

/**
 * Patient opts in to having Tarragon arrange and bill this bundle through
 * the active contracted partner lab (Synlab), instead of the default
 * self-arranged path — never a required step, same "opt-in upgrade"
 * precedent as useRequestLabOrderPartnerVisit below, but this one actually
 * bills: fulfilment='partner' + status='pending_payment' on insert satisfies
 * private.enforce_lab_order_origin (which only special-cases
 * fulfilment='self_arranged') and fires private.set_lab_order_computed_price
 * (BEFORE INSERT only), which authoritatively computes total_kobo,
 * partner_cost_kobo and resolves the provider — the client never sends a
 * price. Only offered for a bundle bundleIsPartnerBillable() said yes to;
 * the trigger re-validates regardless.
 */
export function useCreatePartnerLabOrder() {
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
      screeningScheduleId?: string;
    }) => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("lab_orders")
        .insert({
          organisation_id: organisationId,
          patient_id: patientId,
          panel_bundle_id: panelBundleId,
          fulfilment: "partner",
          status: "pending_payment",
          screening_schedule_id: screeningScheduleId ?? null,
        })
        .select("id, total_kobo")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["lab-orders", variables.patientId] });
      queryClient.invalidateQueries({ queryKey: ["screening-schedules", variables.patientId] });
    },
  });
}

/* useSetLabOrderFacility and its ChooseLabFacility card are removed: a
 * self-arranged order has no facility to set, and public.set_lab_order_facility
 * now refuses one outright. The RPC survives for the dormant partner path. */

/**
 * Distinct from the removed ChooseLabFacility flow above: that one just
 * recorded where a (pre-self-arranged) order would be fulfilled. This one
 * genuinely converts a self-arranged order into a partner-fulfilled one via
 * public.request_lab_order_partner_visit (20260820055147) — an opt-in
 * upgrade path, never shown as a required step, since self-arranged already
 * works today with zero partners on file.
 */
export function useRequestLabOrderPartnerVisit(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      orderId,
      facilityId,
      scheduledDate,
      preferredTimeOfDay,
    }: {
      orderId: string;
      facilityId: string;
      scheduledDate: string;
      preferredTimeOfDay: Database["public"]["Enums"]["lab_order_time_of_day"];
    }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("request_lab_order_partner_visit", {
        p_order_id: orderId,
        p_facility_id: facilityId,
        p_scheduled_date: scheduledDate,
        p_preferred_time_of_day: preferredTimeOfDay,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lab-orders", patientId] });
    },
  });
}

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
