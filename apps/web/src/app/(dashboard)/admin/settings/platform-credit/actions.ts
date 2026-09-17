"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { nairaToKobo } from "@tarragon/shared";

export type PlatformCreditConfigState = { error?: string; message?: string } | undefined;

async function requireAdmin() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") throw new Error("Admin access required");
  return profile;
}

function parseSuggestedAmounts(raw: string): number[] | null {
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0 || parts.length > 8) return null;
  const numbers = parts.map((p) => Number(p));
  if (numbers.some((n) => !Number.isFinite(n) || n <= 0)) return null;
  return numbers;
}

const saveSchema = z
  .object({
    minNaira: z.coerce.number().min(0).max(10_000_000),
    maxNaira: z.coerce.number().min(0).max(10_000_000),
  })
  .refine((d) => d.minNaira < d.maxNaira, {
    message: "The minimum top-up must be less than the maximum.",
  });

/**
 * Updates the single platform_credit_config row. Runs through the admin's
 * own session — the table's update policy gates on private.is_admin() — so a
 * service-role client would bypass that check entirely rather than prove it
 * (same reasoning as growth-config/actions.ts).
 *
 * record_platform_credit_topup_intent reads this row on every top-up
 * attempt, so a change here takes effect immediately, no deploy needed.
 */
export async function savePlatformCreditConfig(
  _prev: PlatformCreditConfigState,
  formData: FormData,
): Promise<PlatformCreditConfigState> {
  await requireAdmin();

  const parsed = saveSchema.safeParse({
    minNaira: formData.get("min_naira"),
    maxNaira: formData.get("max_naira"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the values and try again." };
  }

  const suggestedNaira = parseSuggestedAmounts(String(formData.get("suggested_naira") ?? ""));
  if (!suggestedNaira) {
    return {
      error: "Suggested amounts must be 1 to 8 comma-separated positive numbers, e.g. 10000, 20000, 50000, 100000.",
    };
  }

  const minKobo = nairaToKobo(parsed.data.minNaira);
  const maxKobo = nairaToKobo(parsed.data.maxNaira);
  const suggestedKobo = suggestedNaira.map((n) => nairaToKobo(n)).sort((a, b) => a - b);

  if (suggestedKobo.some((k) => k < minKobo || k > maxKobo)) {
    return { error: "Every suggested amount must fall between the minimum and maximum top-up." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("platform_credit_config")
    .update({
      min_topup_kobo: minKobo,
      max_topup_kobo: maxKobo,
      suggested_amounts_kobo: suggestedKobo,
    })
    .eq("id", true);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/settings/platform-credit");
  return { message: "Platform credit settings saved." };
}
