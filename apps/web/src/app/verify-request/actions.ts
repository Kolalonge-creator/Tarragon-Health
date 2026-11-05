"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { normaliseRequestRef } from "@/lib/lab-results/request-verification";

/**
 * Someone typed the code printed on a request form. Only shape is checked here (the lookup and the rate limit are on the
 * result page); a code that is not even the right shape goes back to the form, never into a URL.
 */
const inputSchema = z.object({ code: z.string().trim().min(1).max(80) });

export async function checkRequestCodeAction(formData: FormData): Promise<void> {
  const parsed = inputSchema.safeParse({ code: formData.get("code") });
  const ref = parsed.success ? normaliseRequestRef(parsed.data.code) : null;
  if (!ref) redirect("/verify-request?invalid=1");
  redirect(`/verify-request/${ref}`);
}
