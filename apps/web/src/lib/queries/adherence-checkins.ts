import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type AdherenceCheckin = Tables<"medication_adherence_checkins">;

export type AdherenceCheckinWithDrug = AdherenceCheckin & {
  medication: { drug_name: string } | null;
};

/** The in-app question shown for each check-in type (pathway Scenario 1, Step 5). */
export function checkinQuestion(type: string, drugName: string | undefined): string {
  const drug = drugName ?? "your medication";
  switch (type) {
    case "started":
      return `Have you started taking ${drug}?`;
    case "side_effects":
      return `Any side effects from ${drug}?`;
    case "missed_doses":
      return `How many doses of ${drug} have you missed recently?`;
    case "lab_review":
      return `It's time for a follow-up review of ${drug}. Anything you'd like your care team to know?`;
    default:
      return `A quick check-in about ${drug}.`;
  }
}

function todayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
}

/** Pending check-ins that are due (on/before today), soonest first. */
export function usePatientDueCheckins(patientId: string) {
  return useQuery({
    queryKey: ["adherence-checkins", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("medication_adherence_checkins")
        .select("*, medication:medications!medication_adherence_checkins_medication_id_fkey(drug_name)")
        .eq("patient_id", patientId)
        .eq("status", "pending")
        .lte("due_date", todayIso())
        .order("due_date", { ascending: true });
      if (error) throw error;
      return data as AdherenceCheckinWithDrug[];
    },
    enabled: !!patientId,
  });
}

/** Patient answers a check-in in the app (WhatsApp/SMS only reminds). */
export function useRespondToCheckin(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ checkinId, response }: { checkinId: string; response: string }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("medication_adherence_checkins")
        .update({
          status: "responded",
          response,
          responded_at: new Date().toISOString(),
        })
        .eq("id", checkinId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adherence-checkins", patientId] });
    },
  });
}
