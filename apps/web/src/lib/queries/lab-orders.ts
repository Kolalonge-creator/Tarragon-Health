import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Database, Tables } from "@tarragon/shared";

export type PanelBundle = Tables<"panel_bundles">;
export type LabProvider = Tables<"lab_providers">;

/**
 * §56.4/§56.6 test-definition fields (specimen/prep/units/reference range/
 * explainer) added by the 2026-08-29 lab-network migration series — not yet
 * reflected in the generated Database type (packages/shared regenerates
 * against the live project; this session has no credentials to run that),
 * so extended locally the same way LabTurnaroundSelfStats and other
 * ahead-of-codegen shapes already are in this file. Regenerate and fold
 * this into Tables<"screen_types"> directly next time codegen runs.
 */
export type ScreenTypeCatalogueFields = {
  specimen_type: string | null;
  preparation_instructions: string | null;
  units: string | null;
  reference_range_text: string | null;
  patient_explainer: string | null;
};

/** One branch of one active laboratory that offers a given test — the
 * §56.7 booking flow's location-selection step. Backed by the
 * list_lab_test_locations RPC (read-only, composes already-readable
 * catalogues), ahead of codegen for the same reason as above. */
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
  opening_hours: Record<string, { open: string; close: string } | null> | null;
  capabilities: string[];
  turnaround_hours: number | null;
  price_kobo: number | null;
};

/** Which branches (across every active, priced laboratory) can actually run
 * this test — pass no code to list every active branch. */
export function useLabTestLocations(testCode: string | null | undefined, state?: string | null) {
  return useQuery({
    queryKey: ["lab-test-locations", testCode, state],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("list_lab_test_locations", {
        p_test_code: testCode ?? undefined,
        p_state: state ?? undefined,
      });
      if (error) throw error;
      return (data ?? []) as LabTestLocation[];
    },
    enabled: !!testCode,
  });
}

/** §56.4/§56.6 catalogue detail for one screen_type — what it is, why it may
 * be requested, prep, and turnaround-relevant fields, for the test-search
 * result / booking prep step. */
export function useScreenTypeDetails(code: string | null | undefined) {
  return useQuery({
    queryKey: ["screen-type-details", code],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("screen_types")
        .select(
          "code, name, specimen_type, preparation_instructions, units, reference_range_text, patient_explainer",
        )
        .eq("code", code as string)
        .maybeSingle();
      if (error) throw error;
      return data as ({ code: string; name: string } & ScreenTypeCatalogueFields) | null;
    },
    enabled: !!code,
  });
}

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
  // test_codes drives, e.g., whether this order needs the ECG-specific
  // uploader alongside (not instead of — a bundle can mix ecg_resting with
  // blood tests) the generic PatientResultUpload, since an ECG is a separate
  // physical document from a lab panel's combined PDF.
  panel_bundle: { name: string; test_codes: string[]; preparation_instructions: string | null } | null;
  provider: { name: string; regions: string[] } | null;
  home_visit_provider: { name: string } | null;
  facility: { name: string } | null;
  // Null-gated "ordered by" attribution (module 57.10) — present only for a
  // clinician-generated order; the patient self-service due-screening path
  // never sets ordered_by, so this stays null there by construction, not by
  // omission from the query.
  ordered_by_staff: { full_name: string; credential_type: string | null; credential_number: string | null } | null;
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
  "*, panel_bundle:panel_bundles!lab_orders_panel_bundle_id_fkey(name, test_codes, preparation_instructions), provider:lab_providers!lab_orders_provider_id_fkey(name, regions), home_visit_provider:home_visit_providers!lab_orders_home_visit_provider_id_fkey(name), facility:facilities!lab_orders_facility_id_fkey(name), ordered_by_staff:clinical_staff!lab_orders_ordered_by_fkey(full_name, credential_type, credential_number)";

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
      const { data, error } = await supabase
        .from("lab_orders")
        .insert({
          organisation_id: organisationId,
          patient_id: patientId,
          panel_bundle_id: panelBundleId,
          total_kobo: 0,
          status: "ordered",
          screening_schedule_id: screeningScheduleId ?? null,
        })
        .select("id")
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
      clinicalIndication,
      urgency,
    }: {
      organisationId: string;
      patientId: string;
      panelBundleId: string;
      /** Required — private.enforce_lab_order_origin rejects a clinician-generated order with none. */
      clinicalIndication: string;
      urgency?: Database["public"]["Enums"]["lab_order_urgency"];
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
        clinical_indication: clinicalIndication,
        urgency: urgency ?? "routine",
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["lab-orders", variables.patientId] });
    },
  });
}

/* useCreatePartnerLabOrder (patient opts in to having Tarragon arrange and
 * bill a catalogue bundle through the contracted partner lab, e.g. Synlab)
 * is removed: every panel_bundles row is guidance_only as of migration
 * 20260910011846_catalogue_becomes_guidance_not_commerce.sql, and
 * private.enforce_guidance_only_is_never_billed refuses a partner-billed
 * lab_orders insert for any of them at the database level regardless of what
 * the client sends. It had no remaining callers — the AHC booking UI's own
 * partner-billed branch was removed 2026-09-11 (see
 * annual-health-check-booking.tsx) once that DB cutover made it a doomed
 * insert behind a generic error. The Care Voucher gift-a-health-check
 * product is a separate, deliberate partner-billed flow (vouchers/actions.ts)
 * and is unaffected. */

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

export type LabOrderTestStatus = Tables<"lab_order_test_status">;
export type TestStatusValue = "not_yet_done" | "done" | "will_not_do";

/**
 * Per-test progress within one order — the checklist on a multi-test panel
 * (e.g. Essential/Core Screen). A test_code with no row is implicitly
 * "not_yet_done"; nothing is pre-seeded (lab-order-test-checklist.tsx).
 */
export function useLabOrderTestStatuses(labOrderId: string | null | undefined) {
  return useQuery({
    queryKey: ["lab-order-test-status", labOrderId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("lab_order_test_status")
        .select("*")
        .eq("lab_order_id", labOrderId as string);
      if (error) throw error;
      return data as LabOrderTestStatus[];
    },
    enabled: !!labOrderId,
  });
}

/** Marks one test within an order done / not yet done / will not be doing. */
export function useSetLabOrderTestStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      labOrderId,
      testCode,
      status,
    }: {
      labOrderId: string;
      testCode: string;
      status: TestStatusValue;
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("lab_order_test_status")
        .upsert(
          { lab_order_id: labOrderId, test_code: testCode, status },
          { onConflict: "lab_order_id,test_code" }
        );
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["lab-order-test-status", variables.labOrderId] });
    },
  });
}
