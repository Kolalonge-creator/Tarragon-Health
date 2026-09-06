import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type EmployerCampaign = Tables<"employer_campaigns">;
export type EmployerCampaignSummary = Tables<"employer_campaign_summary">;
export type EmployerAnnouncement = Tables<"employer_announcements">;

function campaignsKey(organisationId: string) {
  return ["employer-campaigns", organisationId];
}
function announcementsKey(organisationId: string) {
  return ["employer-announcements", organisationId];
}

/** Module 26 §26.10/§26.12. Reads employer_campaign_summary (the aggregate
 * view), never employer_campaign_participants directly — participant-level
 * rows are Tarragon-staff-only, see the migration header. */
export function useEmployerCampaigns(organisationId: string) {
  return useQuery({
    queryKey: campaignsKey(organisationId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("employer_campaign_summary")
        .select("*")
        .eq("organisation_id", organisationId)
        .order("campaign_id", { ascending: false });
      if (error) throw error;
      return data as EmployerCampaignSummary[];
    },
    enabled: !!organisationId,
  });
}

export function useCreateCampaign(organisationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; campaign_type: string; starts_on: string; description?: string }) => {
      const supabase = createClient();
      const { error } = await supabase.from("employer_campaigns").insert({
        organisation_id: organisationId,
        name: input.name,
        campaign_type: input.campaign_type as EmployerCampaign["campaign_type"],
        starts_on: input.starts_on,
        description: input.description || null,
        status: "active",
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: campaignsKey(organisationId) }),
  });
}

/** Module 26 §26.11 — separate from clinical communications, see the
 * migration header on 20260829094032_employer_platform_campaigns_and_announcements.sql. */
export function useEmployerAnnouncements(organisationId: string) {
  return useQuery({
    queryKey: announcementsKey(organisationId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("employer_announcements")
        .select("*")
        .eq("organisation_id", organisationId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as EmployerAnnouncement[];
    },
    enabled: !!organisationId,
  });
}

export function useCreateAndSendAnnouncement(organisationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      title: string;
      body: string;
      department_id?: string | null;
      location_id?: string | null;
      channels: string[];
    }) => {
      const supabase = createClient();
      const { data: inserted, error: insertError } = await supabase
        .from("employer_announcements")
        .insert({
          organisation_id: organisationId,
          title: input.title,
          body: input.body,
          department_id: input.department_id || null,
          location_id: input.location_id || null,
          channels: input.channels as EmployerAnnouncement["channels"],
        })
        .select("id")
        .single();
      if (insertError) throw insertError;

      const { data: recipientCount, error: sendError } = await supabase.rpc(
        "employer_send_announcement",
        { p_announcement_id: inserted.id }
      );
      if (sendError) throw sendError;
      return recipientCount as number;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: announcementsKey(organisationId) }),
  });
}
