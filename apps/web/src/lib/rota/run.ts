import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { rotaErrorMessage } from "./rpc";
import { ROTA_PAGES, safeRotaReturnTo, withOutcome } from "./return-to";

/**
 * The one place a rota or paging form action ends: run the work, then send the person back to a page of the family with the
 * outcome on the query string (?ok= or ?error=), so a failure is never silent. Used by the S18 and S19 server actions.
 */
export async function runAndRedirect(fd: FormData, fallback: (typeof ROTA_PAGES)[number], work: () => Promise<string>): Promise<never> {
  const back = safeRotaReturnTo(fd.get("returnTo"), fallback);
  let outcome: { ok: string } | { error: string };
  try {
    outcome = { ok: await work() };
  } catch (e) {
    outcome = { error: e instanceof z.ZodError ? "Check the details and try again." : (e as { code?: string }).code === "22023" && e instanceof Error ? e.message : rotaErrorMessage(e) };
  }
  revalidatePath(back);
  return redirect(withOutcome(back, outcome));
}
