"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getActingFor } from "@/lib/acting/acting-for";
import { IDENTITY_RECORD_DESCRIPTION, defaultWhatIsWrong, identityChangeSchema, lagosDate } from "./identity-change";

export type IdentityChangeState =
  | { ok: true }
  | { ok: false; error: "invalid" | "not_signed_in" | "acting" | "failed" }
  | undefined;

/**
 * P21: the patient asks for their name or date of birth to be changed. These two facts identify the person on every record, letter and
 * result, so the patient never edits them directly: this opens a request in the existing right-to-rectification workflow
 * (public.data_correction_requests, reviewed by staff at /admin/data-rights), and staff verify it before anything changes. The database
 * forces patient_id, organisation_id and status on insert (private.enforce_data_correction_request_attribution), so a request can only
 * ever be about the caller. While a supporter is acting for someone it is refused: the request would land on the supporter's own record.
 */
export async function requestIdentityChangeAction(_prev: IdentityChangeState, formData: FormData): Promise<IdentityChangeState> {
  const reasonRaw = formData.get("reason");
  const parsed = identityChangeSchema(lagosDate(new Date())).safeParse({
    field: formData.get("field"),
    newValue: formData.get("newValue") ?? "",
    reason: typeof reasonRaw === "string" && reasonRaw.trim() ? reasonRaw : undefined,
  });
  if (!parsed.success) return { ok: false, error: "invalid" };

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "not_signed_in" };
  if (await getActingFor()) return { ok: false, error: "acting" };

  const supabase = await createClient();
  const { data: me, error: meError } = await supabase.from("profiles").select("organisation_id").eq("id", user.id).maybeSingle();
  if (meError || !me?.organisation_id) return { ok: false, error: "failed" };

  const { field, newValue, reason } = parsed.data;
  const { error } = await supabase.from("data_correction_requests").insert({
    organisation_id: me.organisation_id,
    patient_id: user.id,
    record_description: IDENTITY_RECORD_DESCRIPTION[field],
    what_is_wrong: reason ? reason : defaultWhatIsWrong(field),
    requested_change: newValue,
  });
  if (error) return { ok: false, error: "failed" };

  revalidatePath("/patient/privacy");
  return { ok: true };
}
