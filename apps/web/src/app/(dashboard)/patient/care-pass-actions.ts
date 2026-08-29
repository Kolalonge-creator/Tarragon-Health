"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { initiateCarePassCheckout } from "@/lib/billing/care-pass-checkout";

export type BuyCarePassState = { error: string } | undefined;

/** E2 Care Pass — self-purchase, one payment, no auto-renewal. Mirrors
 * requestVideoVisit/requestResultsInterpretation's shape: validate, hand off
 * to the checkout function, redirect. */
export async function buyCarePass(
  _prev: BuyCarePassState,
  formData: FormData,
): Promise<BuyCarePassState> {
  const planCode = formData.get("planCode");
  if (planCode !== "care_pass_12mo" && planCode !== "care_pass_6mo") {
    return { error: "Choose a term first." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!user.email) {
    return { error: "Your account needs an email on file to check out." };
  }

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const result = await initiateCarePassCheckout({
    planCode,
    email: user.email,
    callbackUrl: `${origin}/patient`,
  });

  if (!result.ok) {
    return { error: result.error };
  }
  redirect(result.checkoutUrl);
}
