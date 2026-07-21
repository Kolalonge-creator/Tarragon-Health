import { useMutation } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

const RESULT_DOC_BUCKET = "lab-result-documents";

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

/**
 * A patient uploads their OWN lab result document. The file goes to the private
 * 'lab-result-documents' bucket under the caller's own uid folder (storage RLS),
 * then a row is inserted through the patient's own RLS-scoped session with
 * source='patient'. The insert trigger flags it for clinician review; because
 * the patient uploaded it themselves, no patient notification is queued.
 *
 * Mirrors useAttachVaccinationCertificate — never a public URL, viewed later via
 * a short-lived signed URL.
 */
export function useUploadOwnResultDocument() {
  return useMutation({
    mutationFn: async (input: { file: File; note?: string }): Promise<void> => {
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
      if (!profile?.organisation_id) {
        throw new Error("Your account isn't linked to an organisation yet.");
      }

      const ext = EXT_BY_MIME[input.file.type] ?? "bin";
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(RESULT_DOC_BUCKET)
        .upload(path, input.file, { contentType: input.file.type, upsert: false });
      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase.from("lab_result_documents").insert({
        organisation_id: profile.organisation_id,
        patient_id: user.id,
        file_path: path,
        original_filename: input.file.name,
        mime_type: input.file.type,
        file_size_bytes: input.file.size,
        source: "patient",
        note: input.note?.trim() || null,
      });
      if (insertError) {
        await supabase.storage.from(RESULT_DOC_BUCKET).remove([path]);
        throw insertError;
      }
    },
  });
}
