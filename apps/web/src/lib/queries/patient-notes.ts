import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { parseNoteIndex, parseReleasedNotes } from "@/lib/written-questions/notes";

export const patientNoteKeys = {
  index: ["patient-notes", "index"] as const,
  released: ["patient-notes", "released"] as const,
};

/** The index never carries clinical text; only released notes do. */
export function useMyNoteIndex() {
  return useQuery({
    queryKey: patientNoteKeys.index,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("my_note_index");
      if (error) throw error;
      return parseNoteIndex(data);
    },
  });
}

export function useMyReleasedNotes() {
  return useQuery({
    queryKey: patientNoteKeys.released,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("my_released_notes");
      if (error) throw error;
      return parseReleasedNotes(data);
    },
  });
}

export function useRequestNoteRelease() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (noteId: string) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("request_note_release", { p_note: noteId });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: patientNoteKeys.index }),
  });
}

export function useRequestNoteCorrection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ noteId, text }: { noteId: string; text: string }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("request_note_correction", { p_note: noteId, p_text: text });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: patientNoteKeys.released }),
  });
}
