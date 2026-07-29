import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { uploadResultAsLabPartner } from "@/lib/lab-results/actions";

/**
 * Lab partner surface — the "lab" counterpart of pharmacist (queries/pharmacist.ts).
 * The worklist read goes through a SECURITY DEFINER RPC scoped to the caller's
 * own lab (see 20260727002742_lab_partner_surface.sql); the upload write goes
 * through a server action since it also handles the storage upload.
 */
export function useLabPartnerOrders() {
  return useQuery({
    queryKey: ["lab-partner-orders"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("lab_partner_orders");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useLabPartnerUploadResult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      orderId,
      file,
      note,
    }: {
      orderId: string;
      file: File;
      note?: string;
    }) => {
      const formData = new FormData();
      formData.set("order_id", orderId);
      formData.set("file", file);
      if (note?.trim()) formData.set("note", note.trim());
      const result = await uploadResultAsLabPartner(formData);
      if (result.error) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lab-partner-orders"] });
    },
  });
}
