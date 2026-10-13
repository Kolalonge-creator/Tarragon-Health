import { redirect } from "next/navigation";

/** The page was renamed "triage agreement" (S75, decision S75-3: it measures agreement, not accuracy). Old bookmarks land on the new address. */
export default function OldTriageAccuracyAddress(): never {
  redirect("/admin/triage-agreement");
}
