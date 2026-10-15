import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { loadReviewQueueAction } from "./actions";
import { AssistantReviewClient } from "./review-client";

export const metadata = { title: "Assistant monthly review" };
export const dynamic = "force-dynamic";

/** Chief Medical Officer only. Their account role is `clinician`, so this lives under /clinician; the pages and the database both refuse anyone else. */
export default async function AssistantReviewPage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  const queue = await loadReviewQueueAction();
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">Assistant monthly review</h1>
      <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
        Every month a random sample of assistant conversations is chosen, plus every conversation a patient reported. Opening one asks you for a
        reason and is recorded. Nothing here changes the patient&apos;s record.
      </p>
      {queue.ok ? <AssistantReviewClient initial={queue.rows} /> : <p role="alert">{queue.error}</p>}
    </div>
  );
}
