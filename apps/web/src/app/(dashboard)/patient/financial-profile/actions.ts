"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { payMySubsidyShare } from "@/lib/billing/subsidy-checkout";

export type FinancialProfileActionState = { error?: string } | undefined;

/**
 * Pays the caller's own share of a §91.9 subsidized bill — either the
 * patient's reduced share, or (if abandoned earlier) the sponsor's own
 * share. RLS on subsidy_contributions already scopes this to the caller.
 */
export async function payMyShare(
  _prevState: FinancialProfileActionState,
  formData: FormData,
): Promise<FinancialProfileActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };
  if (!user.email) return { error: "Your account needs an email on file to check out." };

  const contributionId = formData.get("contributionId") as string;
  if (!contributionId) return { error: "Which share are you paying?" };

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const result = await payMySubsidyShare({
    contributionId,
    email: user.email,
    callbackUrl: `${origin}/patient/financial-profile`,
  });

  if (!result.ok) return { error: result.error };
  redirect(result.checkoutUrl);
}
