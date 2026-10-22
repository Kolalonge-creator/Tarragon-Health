"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";

export type DeviceActionState = { error?: string; success?: boolean } | undefined;

const addSchema = z.object({
  device_name: z.string().trim().min(4, "Give the model name (at least 4 characters).").max(120),
  vendor_name: z.string().trim().max(120).optional(),
  description: z.string().trim().max(300).optional(),
  validated_source_url: z
    .string()
    .trim()
    .url("The validation link must be a full web address.")
    .max(500)
    .refine((u) => /^https?:\/\//i.test(u), "The validation link must start with http or https."),
  validation_basis: z.enum(["validatebp", "published_validation_study"], { message: "Say where the validation was found." }),
  nafdac_number: z.string().trim().max(60).optional(),
  authorised_distributor: z.string().trim().max(120).optional(),
});

const blank = (v: FormDataEntryValue | null) => (typeof v === "string" && v.trim() !== "" ? v : undefined);

/**
 * An admin enters a blood pressure monitor with the public place its validation was found. The row is born unreviewed and inactive for patients:
 * only the Chief Medical Officer's review (review_device_catalog_entry) makes it count. Nothing is invented here; the admin types what a registry says.
 */
export async function addBpDevice(_prev: DeviceActionState, formData: FormData): Promise<DeviceActionState> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") return { error: "Only an admin can add a monitor." };
  const parsed = addSchema.safeParse({
    device_name: formData.get("device_name"),
    vendor_name: blank(formData.get("vendor_name")),
    description: blank(formData.get("description")),
    validated_source_url: formData.get("validated_source_url"),
    validation_basis: formData.get("validation_basis"),
    nafdac_number: blank(formData.get("nafdac_number")),
    authorised_distributor: blank(formData.get("authorised_distributor")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const supabase = await createClient();
  const { error } = await supabase.from("device_catalog").insert({
    ...parsed.data,
    category: "blood_pressure",
    fulfillment_type: "recommend_only",
    pairing_path: "manual_only",
    active: true,
    clinically_reviewed: false,
  });
  if (error) return { error: "That did not save. Please try again." };
  revalidatePath("/admin/settings/recommended-devices");
  revalidatePath("/clinician/recommended-devices");
  return { success: true };
}

const idSchema = z.object({ id: z.string().uuid() });

/** An admin takes a monitor off the list (it stays on record, inactive). */
export async function deactivateBpDevice(formData: FormData): Promise<void> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") throw new Error("Only an admin can take a monitor off the list.");
  const parsed = idSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) throw new Error("That monitor could not be found.");
  const supabase = await createClient();
  const { data, error } = await supabase.from("device_catalog").update({ active: false }).eq("id", parsed.data.id).eq("category", "blood_pressure").select("id");
  // A refused or empty update must not look like success on a list a patient message depends on: the error page says so.
  if (error || !data || data.length === 0) throw new Error("The monitor was not taken off the list. Please try again.");
  revalidatePath("/admin/settings/recommended-devices");
  revalidatePath("/clinician/recommended-devices");
}

const reviewSchema = z.object({
  id: z.string().uuid(),
  reviewed: z.enum(["yes", "no"]),
  note: z.string().trim().max(500).optional(),
});

/** The Chief Medical Officer records that she checked the model against the public registry (or withdraws that). The database checks the role and the evidence. */
export async function reviewBpDevice(_prev: DeviceActionState, formData: FormData): Promise<DeviceActionState> {
  const parsed = reviewSchema.safeParse({ id: formData.get("id"), reviewed: formData.get("reviewed"), note: blank(formData.get("note")) });
  if (!parsed.success) return { error: "Please check the form." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_device_catalog_entry", { p_id: parsed.data.id, p_reviewed: parsed.data.reviewed === "yes", p_note: parsed.data.note });
  if (error) {
    if (error.message.includes("only the Chief Medical Officer")) return { error: "Only the Chief Medical Officer can review a monitor." };
    if (error.message.includes("say what was checked")) return { error: "Say what you checked, in a sentence." };
    return { error: "That did not work. The monitor needs a validation link, a NAFDAC number or distributor, and a note." };
  }
  revalidatePath("/clinician/recommended-devices");
  revalidatePath("/clinician/clinical-signoff");
  return { success: true };
}
