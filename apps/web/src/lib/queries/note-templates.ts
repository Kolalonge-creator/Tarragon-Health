import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type NoteTemplate = Tables<"note_templates">;

function noteTemplatesKey(organisationId: string) {
  return ["note-templates", organisationId];
}

/** Care Team / Provider Workspace §5.8 — org-shared, clinician-authored
 * reusable text. Alphabetical by title, cheap enough to fetch in full
 * (no org is expected to accumulate thousands of these). */
export function useNoteTemplates(organisationId: string) {
  return useQuery({
    queryKey: noteTemplatesKey(organisationId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("note_templates")
        .select("*")
        .eq("organisation_id", organisationId)
        .order("title", { ascending: true });
      if (error) throw error;
      return data as NoteTemplate[];
    },
    enabled: !!organisationId,
  });
}

export function useCreateNoteTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      organisationId,
      title,
      body,
    }: {
      organisationId: string;
      title: string;
      body: string;
    }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error } = await supabase.from("note_templates").insert({
        organisation_id: organisationId,
        created_by: user?.id ?? null,
        title,
        body,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: noteTemplatesKey(variables.organisationId) });
    },
  });
}

export function useDeleteNoteTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; organisationId: string }) => {
      const supabase = createClient();
      const { error } = await supabase.from("note_templates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: noteTemplatesKey(variables.organisationId) });
    },
  });
}
