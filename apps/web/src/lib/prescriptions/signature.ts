import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { SIGNATURE_BUCKET, signatureDataUrl } from "@/lib/clinical/signature-image";

/**
 * The prescriber's signature image as a data URL, for embedding in a prescription PDF.
 *
 * Read with the SERVICE ROLE because the image lives in a private bucket no patient can read (it is a forgery risk
 * if exposed). That is acceptable only because this runs AFTER the prescription has passed every issuing rule for a
 * caller who is entitled to it, and the bytes go into the PDF and nowhere else: the path is never returned, and no
 * URL is created. A missing signature, a failed download or a file that is not really a PNG or JPEG all return null
 * and the document prints with the electronic-signature stamp alone; they never block the prescription.
 */
export async function loadPrescriberSignature(prescriberProfileId: string | null): Promise<string | null> {
  if (!prescriberProfileId) return null;
  try {
    const service = createServiceRoleClient();
    const { data: staff } = await service
      .from("clinical_staff")
      .select("signature_path")
      .eq("profile_id", prescriberProfileId)
      .maybeSingle();
    if (!staff?.signature_path) return null;
    const { data: blob, error } = await service.storage.from(SIGNATURE_BUCKET).download(staff.signature_path);
    if (error || !blob) return null;
    return signatureDataUrl(new Uint8Array(await blob.arrayBuffer()));
  } catch {
    return null;
  }
}
