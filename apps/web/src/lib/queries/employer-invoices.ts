import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type EmployerInvoice = Tables<"employer_invoices">;

function invoicesKey(organisationId: string) {
  return ["employer-invoices", organisationId];
}

/** Module 26 §26.15 — the employer reads its own invoices (see
 * employer_invoices_select); it never generates or changes their status,
 * that stays Tarragon-finance-only (private.is_finance()). */
export function useEmployerInvoices(organisationId: string) {
  return useQuery({
    queryKey: invoicesKey(organisationId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("employer_invoices")
        .select("*")
        .eq("organisation_id", organisationId)
        .order("period_start", { ascending: false });
      if (error) throw error;
      return data as EmployerInvoice[];
    },
    enabled: !!organisationId,
  });
}

/** Finance/admin only — see public.employer_generate_invoice. */
export function useGenerateInvoice(organisationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { periodStart: string; periodEnd: string }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("employer_generate_invoice", {
        p_organisation_id: organisationId,
        p_period_start: input.periodStart,
        p_period_end: input.periodEnd,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: invoicesKey(organisationId) }),
  });
}

/** Finance/admin only — see public.employer_set_invoice_status. */
export function useSetInvoiceStatus(organisationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { invoiceId: string; status: string; voidReason?: string }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("employer_set_invoice_status", {
        p_invoice_id: input.invoiceId,
        p_status: input.status,
        p_void_reason: input.voidReason,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: invoicesKey(organisationId) }),
  });
}
