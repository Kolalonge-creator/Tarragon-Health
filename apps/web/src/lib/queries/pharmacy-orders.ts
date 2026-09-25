import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type PharmacyMedication = Tables<"pharmacy_medications">;
export type PharmacyPartner = Tables<"pharmacy_partners">;

type PharmacyPartnerSummary = Pick<
  PharmacyPartner,
  "id" | "name" | "delivery" | "regions" | "address" | "latitude" | "longitude" | "state" | "city" | "area" | "delivery_fee_kobo"
>;

export type PharmacyMedicationWithPartner = PharmacyMedication & {
  pharmacy_partner: PharmacyPartnerSummary | null;
};

/**
 * `pharmacy_partner` used to be embedded directly via
 * `pharmacy_partners!pharmacy_medications_pharmacy_partner_id_fkey(...)` — a
 * PostgREST embedded join, which resolves against pharmacy_partners' OWN
 * RLS, not this query's own. Since 2026-09-25
 * (20260925023144_restrict_lab_pharmacy_partner_read_to_safe_columns.sql)
 * that policy no longer admits a patient session, so the embed would
 * silently come back null for every medication. Fetched separately from
 * public.pharmacy_partner_directory (the safe-column view every other
 * patient-facing read of pharmacy_partners now uses) and merged
 * client-side instead.
 *
 * `is_active` is selected deliberately, unlike every other column here: the
 * directory view itself carries every partner row regardless of status (see
 * 20260925024716_fix_lab_pharmacy_directory_active_filter_and_replay_guard.sql
 * — a patient's own past order still needs to show which partner it was
 * even after that partner goes inactive), so a bookable *catalogue* has to
 * filter it out itself. attachPharmacyPartners below does that by dropping
 * the row entirely, not by nulling the partner and leaving the medication
 * orderable — a medication whose partner had gone inactive was previously
 * still bookable with the patient shown no identifying info at all, because
 * the location filter's "no structured address, don't hide it" escape
 * hatch also matched a null partner.
 */
async function fetchPharmacyPartners(
  supabase: ReturnType<typeof createClient>,
  partnerIds: string[],
): Promise<Map<string, PharmacyPartnerSummary>> {
  const partnerById = new Map<string, PharmacyPartnerSummary>();
  if (partnerIds.length === 0) return partnerById;
  const { data, error } = await supabase
    .from("pharmacy_partner_directory")
    .select("id, name, delivery, regions, address, latitude, longitude, state, city, area, delivery_fee_kobo, is_active")
    .in("id", partnerIds);
  if (error) throw error;
  for (const row of data ?? []) {
    if (!row.id || row.is_active === false) continue;
    partnerById.set(row.id, {
      id: row.id,
      name: row.name ?? "",
      delivery: row.delivery ?? false,
      regions: row.regions ?? [],
      address: row.address,
      latitude: row.latitude,
      longitude: row.longitude,
      state: row.state,
      city: row.city,
      area: row.area,
      delivery_fee_kobo: row.delivery_fee_kobo,
    });
  }
  return partnerById;
}

/** Exported for direct testing (see pharmacy-orders.test.ts) — not part of the public hook API. */
export async function attachPharmacyPartners(
  supabase: ReturnType<typeof createClient>,
  rows: PharmacyMedication[],
): Promise<PharmacyMedicationWithPartner[]> {
  const partnerIds = Array.from(
    new Set(rows.map((r) => r.pharmacy_partner_id).filter((id): id is string => !!id)),
  );
  const partnerById = await fetchPharmacyPartners(supabase, partnerIds);
  // A medication whose partner is missing or inactive is dropped outright,
  // not returned with pharmacy_partner: null — this is a bookable catalogue,
  // and the old embed's behaviour (no is_active filter at all) never let an
  // inactive partner's medications appear here in the first place. See the
  // comment on fetchPharmacyPartners for why this is different from every
  // other directory-view consumer in this codebase, which deliberately keep
  // an inactive-partner row (attribution, not a picker).
  return rows
    .filter((row) => !!row.pharmacy_partner_id && partnerById.has(row.pharmacy_partner_id))
    .map((row) => ({
      ...row,
      pharmacy_partner: partnerById.get(row.pharmacy_partner_id as string) ?? null,
    }));
}

/** Active pharmacy_medications joined to their partner — every seeded row is directly bookable (no catalogue gap like lab's panel_bundle workaround). Partner address/coordinates power nearest-pharmacy selection. */
export function usePharmacyCatalogue() {
  return useQuery({
    queryKey: ["pharmacy-catalogue"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("pharmacy_medications")
        .select("*")
        .eq("is_active", true)
        .order("drug_name", { ascending: true });
      if (error) throw error;
      return attachPharmacyPartners(supabase, (data ?? []) as PharmacyMedication[]);
    },
  });
}

export type PharmacyOrderItem = {
  medication_id: string;
  drug_name: string;
  pack_size: string | null;
  price_kobo: number;
  quantity: number;
  /** Snapshotted from pharmacy_medications.requires_cold_chain at order time (spec §63.11). */
  requires_cold_chain?: boolean;
};

export type PharmacyOrder = Tables<"pharmacy_orders">;

export type PharmacyOrderWithLogistics = PharmacyOrder & {
  logistics_partner: { name: string; delivery_fee_kobo: number; supports_cold_chain: boolean } | null;
};

const PHARMACY_ORDER_SELECT =
  "*, logistics_partner:logistics_partners!pharmacy_orders_logistics_partner_id_fkey(name, delivery_fee_kobo, supports_cold_chain)";

/** Patient's own pharmacy_orders, newest first. Client hook from the start — Build 4's lab-orders-list bug (server component missed cache invalidation) taught this. */
export function usePatientPharmacyOrders(patientId: string) {
  return useQuery({
    queryKey: ["pharmacy-orders", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("pharmacy_orders")
        .select(PHARMACY_ORDER_SELECT)
        .eq("patient_id", patientId)
        .order("requested_at", { ascending: false });
      if (error) throw error;
      return data as PharmacyOrderWithLogistics[];
    },
    enabled: !!patientId,
  });
}

/**
 * All pharmacy_orders in the caller's org, newest first — ops/clinician
 * worklist for assigning a courier/logistics partner. RLS
 * (private.is_org_staff) does the org-scoping.
 */
export function useOrgPharmacyOrders() {
  return useQuery({
    queryKey: ["pharmacy-orders", "org"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("pharmacy_orders")
        .select(PHARMACY_ORDER_SELECT)
        .order("requested_at", { ascending: false });
      if (error) throw error;
      return data as PharmacyOrderWithLogistics[];
    },
  });
}

export type PharmacyOrderDispense = Tables<"pharmacy_order_dispenses">;

/** Dispense records logged against a pharmacy order (what was collected). */
export function useOrderDispenses(orderId: string) {
  return useQuery({
    queryKey: ["pharmacy-order-dispenses", orderId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("pharmacy_order_dispenses")
        .select("*")
        .eq("pharmacy_order_id", orderId)
        .order("dispensed_on", { ascending: false });
      if (error) throw error;
      return data as PharmacyOrderDispense[];
    },
    enabled: !!orderId,
  });
}

/**
 * Record a dispense against an order. The patient may log what they collected
 * themselves (source 'patient') — important for no-login pharmacies; org staff
 * / a logged-in pharmacist log source 'pharmacy'. RLS scopes writes to the
 * order owner or org staff.
 */
export function useRecordDispense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      order,
      drugName,
      quantity,
      dispensedOn,
      source,
      recordedBy,
      quantityPrescribed,
      isPartial,
      outstandingNote,
    }: {
      order: Pick<PharmacyOrder, "id" | "organisation_id" | "patient_id">;
      drugName: string;
      quantity: string | null;
      dispensedOn: string;
      source: "patient" | "pharmacy";
      recordedBy: string;
      /** Spec §63.5 partial-dispensing distinction — same fields as the pharmacist RPC, for the patient self-report path. */
      quantityPrescribed?: string | null;
      isPartial?: boolean;
      outstandingNote?: string | null;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("pharmacy_order_dispenses").insert({
        organisation_id: order.organisation_id,
        patient_id: order.patient_id,
        pharmacy_order_id: order.id,
        drug_name: drugName,
        quantity: quantity,
        dispensed_on: dispensedOn,
        source,
        recorded_by: recordedBy,
        quantity_prescribed: quantityPrescribed || null,
        is_partial: isPartial ?? false,
        outstanding_note: outstandingNote || null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pharmacy-order-dispenses", variables.order.id] });
    },
  });
}

export type PharmacyOrderDeliveryAttempt = Tables<"pharmacy_order_delivery_attempts">;

/** Delivery-attempt history for an order (spec §63.10) — newest first. */
export function useOrderDeliveryAttempts(orderId: string) {
  return useQuery({
    queryKey: ["pharmacy-order-delivery-attempts", orderId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("pharmacy_order_delivery_attempts")
        .select("*")
        .eq("pharmacy_order_id", orderId)
        .order("attempted_at", { ascending: false });
      if (error) throw error;
      return data as PharmacyOrderDeliveryAttempt[];
    },
    enabled: !!orderId,
  });
}

/**
 * Patient books a medication with a chosen quantity. pharmacy_orders' INSERT
 * RLS allows patient_id = auth.uid() directly, same generic-loop policy
 * shape as lab_orders (confirmed in Build 4's research) — no server
 * action/service-role needed for this step. items snapshots drug
 * name/pack/price at order time, same fee-locking pattern as Builds 3/4.
 */
export function useCreatePharmacyOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      organisationId,
      patientId,
      pharmacyPartnerId,
      medication,
      quantity,
      fulfilmentMethod = "pickup",
      deliveryFeeKobo,
    }: {
      organisationId: string;
      patientId: string;
      pharmacyPartnerId: string;
      medication: PharmacyMedication;
      quantity: number;
      /** Delivery is model-ready but gated in the UI until logistics partners onboard — defaults to pickup. */
      fulfilmentMethod?: "pickup" | "delivery";
      /** The pharmacy's own flat fee (pharmacy_partners.delivery_fee_kobo) —
       * only added to the total when fulfilmentMethod is "delivery"; ignored
       * for pickup, matching §12.7's "delivery fee" price-visibility line. */
      deliveryFeeKobo?: number | null;
    }) => {
      const supabase = createClient();
      const item: PharmacyOrderItem = {
        medication_id: medication.id,
        drug_name: medication.drug_name,
        pack_size: medication.pack_size,
        price_kobo: medication.price_kobo,
        quantity,
        requires_cold_chain: medication.requires_cold_chain,
      };
      const totalKobo =
        medication.price_kobo * quantity +
        (fulfilmentMethod === "delivery" ? (deliveryFeeKobo ?? 0) : 0);
      const { error } = await supabase.from("pharmacy_orders").insert({
        organisation_id: organisationId,
        patient_id: patientId,
        pharmacy_partner_id: pharmacyPartnerId,
        items: [item],
        total_kobo: totalKobo,
        status: "pending_payment",
        fulfilment_method: fulfilmentMethod,
        requires_cold_chain: medication.requires_cold_chain,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pharmacy-orders", variables.patientId] });
    },
  });
}
