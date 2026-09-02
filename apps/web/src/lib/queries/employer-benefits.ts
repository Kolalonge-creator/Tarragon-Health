import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type EmployerBenefitPackage = Tables<"employer_benefit_packages">;
export type EmployerBenefitAllowance = Tables<"employer_benefit_allowances">;
export type SubscriptionPlan = Tables<"service_products">;

function packagesKey(organisationId: string) {
  return ["employer-benefit-packages", organisationId];
}
function allowancesKey(packageId: string) {
  return ["employer-benefit-allowances", packageId];
}

/** Module 26 §26.6/§26.7 — what an employer purchases. Reuses the platform's
 * own service_products catalogue (see the migration header on
 * 20260829093527_employer_platform_benefit_packages_entitlement_wiring.sql;
 * employer_benefit_packages.subscription_plan_id was later rewired to
 * service_product_id / service_products as part of the 2026-09-02
 * subscriptions-to-pay-per-service cutover — see
 * project_subscription_to_pay_per_service_cutover_20260902 in memory)
 * rather than a second feature-toggle system. */
export function useBenefitPackages(organisationId: string) {
  return useQuery({
    queryKey: packagesKey(organisationId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("employer_benefit_packages")
        .select("*")
        .eq("organisation_id", organisationId)
        .eq("is_active", true)
        .order("created_at");
      if (error) throw error;
      return data as EmployerBenefitPackage[];
    },
    enabled: !!organisationId,
  });
}

/** The plan tiers a package can reference — same catalogue individual
 * patients buy from directly. */
export function useSubscriptionPlanCatalog() {
  return useQuery({
    queryKey: ["subscription-plan-catalog"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("service_products")
        .select("*")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as SubscriptionPlan[];
    },
  });
}

export function useCreateBenefitPackage(organisationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      service_product_id: string;
      lab_discount_percent?: number;
      is_default?: boolean;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("employer_benefit_packages").insert({
        organisation_id: organisationId,
        name: input.name,
        service_product_id: input.service_product_id,
        lab_discount_percent: input.lab_discount_percent ?? 0,
        is_default: input.is_default ?? false,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: packagesKey(organisationId) }),
  });
}

export function useBenefitAllowances(packageId: string) {
  return useQuery({
    queryKey: allowancesKey(packageId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("employer_benefit_allowances")
        .select("*")
        .eq("package_id", packageId)
        .order("allowance_type");
      if (error) throw error;
      return data as EmployerBenefitAllowance[];
    },
    enabled: !!packageId,
  });
}

export function useSetBenefitAllowance(packageId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { allowance_type: string; annual_limit: number }) => {
      const supabase = createClient();
      const { error } = await supabase.from("employer_benefit_allowances").upsert(
        {
          package_id: packageId,
          allowance_type: input.allowance_type as EmployerBenefitAllowance["allowance_type"],
          annual_limit: input.annual_limit,
        },
        { onConflict: "package_id,allowance_type" }
      );
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: allowancesKey(packageId) }),
  });
}
