import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Json, Tables } from "@tarragon/shared";

export type ProtocolDraft = Tables<"protocol_drafts"> & {
  authored_by: { full_name: string } | null;
};
export type ProtocolDraftComment = Tables<"protocol_draft_comments"> & {
  commented_by: { full_name: string } | null;
};

const DRAFTS_KEY = ["protocol-drafts"];
const commentsKey = (draftId: string) => ["protocol-draft-comments", draftId];

async function getCallerOrganisationId(): Promise<string> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) throw new Error("This account has no organisation on file");
  return profile.organisation_id;
}

/** Every protocol draft in the caller's org, newest first. Any org staff may read. */
export function useProtocolDrafts() {
  return useQuery({
    queryKey: DRAFTS_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("protocol_drafts")
        .select("*, authored_by:clinical_staff!protocol_drafts_authored_by_staff_fkey(full_name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ProtocolDraft[];
    },
  });
}

/**
 * Starts a new protocol draft. authored_by_staff/profile and status are
 * server-derived by private.enforce_protocol_draft_attribution — requires
 * an active clinical-tier caller (any tier, not Director-only, unlike
 * signing a version directly).
 */
export function useCreateProtocolDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      protocolId: string;
      title: string;
      changeSummary: string;
      content: Json;
      evidenceBasis?: string;
      applicablePopulation?: string;
      specialty?: string;
    }) => {
      const supabase = createClient();
      const organisationId = await getCallerOrganisationId();
      const { error } = await supabase.from("protocol_drafts").insert({
        organisation_id: organisationId,
        protocol_id: input.protocolId,
        title: input.title,
        change_summary: input.changeSummary,
        content: input.content,
        evidence_basis: input.evidenceBasis || null,
        applicable_population: input.applicablePopulation || null,
        specialty: input.specialty || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DRAFTS_KEY });
    },
  });
}

/** Moves a draft between draft/in_review — any clinical-tier author may toggle this. */
export function useSetProtocolDraftStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ draftId, status }: { draftId: string; status: "draft" | "in_review" }) => {
      const supabase = createClient();
      const { error } = await supabase.from("protocol_drafts").update({ status }).eq("id", draftId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DRAFTS_KEY });
    },
  });
}

/** Review comments on one draft, oldest first. */
export function useProtocolDraftComments(draftId: string) {
  return useQuery({
    queryKey: commentsKey(draftId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("protocol_draft_comments")
        .select("*, commented_by:clinical_staff!protocol_draft_comments_commented_by_staff_fkey(full_name)")
        .eq("draft_id", draftId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as ProtocolDraftComment[];
    },
    enabled: Boolean(draftId),
  });
}

/** Leaves a review comment. commented_by_staff is server-derived, requires clinical tier. */
export function useAddProtocolDraftComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ draftId, body }: { draftId: string; body: string }) => {
      const supabase = createClient();
      const organisationId = await getCallerOrganisationId();
      const { error } = await supabase
        .from("protocol_draft_comments")
        .insert({ draft_id: draftId, organisation_id: organisationId, body });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: commentsKey(variables.draftId) });
    },
  });
}

/**
 * Promotes a draft into a real, signed protocol_versions row via the
 * promote_protocol_draft() RPC — Director-only, enforced server-side.
 */
export function usePromoteProtocolDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (draftId: string) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("promote_protocol_draft", { p_draft_id: draftId });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DRAFTS_KEY });
      queryClient.invalidateQueries({ queryKey: ["protocol-versions"] });
    },
  });
}

/** Rejects a draft — Director-only, terminal, requires a stated reason. */
export function useRejectProtocolDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ draftId, reason }: { draftId: string; reason: string }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("reject_protocol_draft", { p_draft_id: draftId, p_reason: reason });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DRAFTS_KEY });
    },
  });
}
