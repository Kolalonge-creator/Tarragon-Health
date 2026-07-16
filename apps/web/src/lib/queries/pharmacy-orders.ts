import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type PharmacyMedication = Tables<"pharmacy_medications">;
export type PharmacyPartner = Tables<"pharmacy_partners">;

export type PharmacyMedicationWithPartner = PharmacyMedication & {
  pharmacy_partner: Pick<
    PharmacyPartner,
    "id" | "name" | "delivery" | "regions" | "address" | "latitude" | "longitude" | "state" | "city" | "area"
  > | null;
};

/** Active pharmacy_medications joined to their partner — every seeded row is directly bookable (no catalogue gap like lab's panel_bundle workaround). Partner address/coordinates power nearest-pharmacy selection. */
export function usePharmacyCatalogue() {
  return useQuery({
    queryKey: ["pharmacy-catalogue"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("pharmacy_medications")
        .select(
          "*, pharmacy_partner:pharmacy_partners!pharmacy_medications_pharmacy_partner_id_fkey(id, name, delivery, regions, address, latitude, longitude, state, city, area)",
        )
        .eq("is_active", true)
        .order("drug_name", { ascending: true });
      if (error) throw error;
      return data as PharmacyMedicationWithPartner[];
    },
  });
}

export type PharmacyOrderItem = {
  medication_id: string;
  drug_name: string;
  pack_size: string | null;
  price_kobo: number;
  quantity: number;
};

export type PharmacyOrder = Tables<"pharmacy_orders">;

export type PharmacyOrderWithLogistics = PharmacyOrder & {
  logistics_partner: { name: string } | null;
};

const PHARMACY_ORDER_SELECT =
  "*, logistics_partner:logistics_partners!pharmacy_orders_logistics_partner_id_fkey(name)";

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
    }: {
      organisationId: string;
      patientId: string;
      pharmacyPartnerId: string;
      medication: PharmacyMedication;
      quantity: number;
      /** Delivery is model-ready but gated in the UI until logistics partners onboard — defaults to pickup. */
      fulfilmentMethod?: "pickup" | "delivery";
    }) => {
      const supabase = createClient();
      const item: PharmacyOrderItem = {
        medication_id: medication.id,
        drug_name: medication.drug_name,
        pack_size: medication.pack_size,
        price_kobo: medication.price_kobo,
        quantity,
      };
      const { error } = await supabase.from("pharmacy_orders").insert({
        organisation_id: organisationId,
        patient_id: patientId,
        pharmacy_partner_id: pharmacyPartnerId,
        items: [item],
        total_kobo: medication.price_kobo * quantity,
        status: "pending_payment",
        fulfilment_method: fulfilmentMethod,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pharmacy-orders", variables.patientId] });
    },
  });
}
