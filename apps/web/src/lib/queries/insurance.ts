import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type InsurancePolicy = Tables<"insurance_policies">;
export type InsuranceBenefit = Tables<"insurance_benefits">;
export type InsurancePreauthorization = Tables<"insurance_preauthorizations">;
export type InsuranceClaim = Tables<"insurance_claims">;
export type Insurer = Pick<Tables<"insurers">, "id" | "name">;

/** A patient's own insurance policies, most recently added first. RLS already
 * scopes this to the caller's own patient_id — no organisation filter needed. */
export function usePatientInsurancePolicies(patientId: string) {
  return useQuery({
    queryKey: ["insurance-policies", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("insurance_policies")
        .select("*, insurer:insurers(id, name)")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as (InsurancePolicy & { insurer: Insurer | null })[];
    },
    enabled: !!patientId,
  });
}

/** The benefit schedule for one insurer, optionally narrowed to a plan name.
 * insurance_benefits is a product catalogue (readable by any signed-in
 * account), not per-patient data, so this isn't further scoped to patientId. */
export function useInsuranceBenefits(insurerId: string | null, planName: string | null) {
  return useQuery({
    queryKey: ["insurance-benefits", insurerId, planName],
    queryFn: async () => {
      const supabase = createClient();
      let query = supabase.from("insurance_benefits").select("*").eq("insurer_id", insurerId as string);
      // A plan-specific row always wins over the insurer's plan-agnostic
      // default (plan_name is null) — same precedence check_insurance_coverage()
      // uses, so a patient reading their benefits sees the same numbers a
      // booking flow would quote them.
      query = planName ? query.or(`plan_name.eq.${planName},plan_name.is.null`) : query.is("plan_name", null);
      const { data, error } = await query.order("service_category", { ascending: true });
      if (error) throw error;
      return data as InsuranceBenefit[];
    },
    enabled: !!insurerId,
  });
}

/** A patient's own pre-authorisation requests, across all their policies. */
export function usePatientPreauthorizations(patientId: string) {
  return useQuery({
    queryKey: ["insurance-preauthorizations", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("insurance_preauthorizations")
        .select("*, policy:insurance_policies!inner(patient_id)")
        .eq("policy.patient_id", patientId)
        .order("requested_at", { ascending: false });
      if (error) throw error;
      return data as (InsurancePreauthorization & { policy: { patient_id: string } })[];
    },
    enabled: !!patientId,
  });
}

/** A patient's own insurance claims, across all their policies. */
export function usePatientInsuranceClaims(patientId: string) {
  return useQuery({
    queryKey: ["insurance-claims", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("insurance_claims")
        .select("*, policy:insurance_policies!inner(patient_id)")
        .eq("policy.patient_id", patientId)
        .order("submitted_at", { ascending: false });
      if (error) throw error;
      return data as (InsuranceClaim & { policy: { patient_id: string } })[];
    },
    enabled: !!patientId,
  });
}

export type NewInsurancePolicy = {
  insurerId: string;
  memberId: string;
  planName: string | null;
  policyHolderName: string | null;
  relationship: Tables<"insurance_policies">["relationship"];
  groupNumber: string | null;
};

/** A patient recording their own policy card, unverified until staff confirm
 * it (insurance_policies_patient_insert RLS enforces verified_at/verified_by
 * stay null on this insert — the same policy this mutation relies on rather
 * than re-checking client-side). */
export function useAddInsurancePolicy(patientId: string, organisationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (policy: NewInsurancePolicy) => {
      const supabase = createClient();
      const { error } = await supabase.from("insurance_policies").insert({
        organisation_id: organisationId,
        patient_id: patientId,
        insurer_id: policy.insurerId,
        member_id: policy.memberId,
        plan_name: policy.planName,
        policy_holder_name: policy.policyHolderName,
        relationship: policy.relationship,
        group_number: policy.groupNumber,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["insurance-policies", patientId] });
    },
  });
}

/** The insurer directory for the "add your insurance" picker — id/name only,
 * every insurer regardless of insurers.is_active: a patient recording a
 * policy for an insurer Tarragon hasn't operationally activated yet is a
 * normal pending state (verified_at/verified_by gates it), not an error. */
export function useInsurerDirectory() {
  return useQuery({
    queryKey: ["insurer-directory"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.from("insurers").select("id, name").order("name", { ascending: true });
      if (error) throw error;
      return data as Insurer[];
    },
  });
}
