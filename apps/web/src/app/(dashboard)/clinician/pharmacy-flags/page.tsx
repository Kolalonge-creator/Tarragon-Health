import { redirect } from "next/navigation";

/**
 * S36h's page is folded into /clinician/pharmacy (S28): the same prescriber, the same audited read, and the earlier written messages are
 * listed there, read only. This path stays so an old link or an old notice still lands somewhere useful.
 */
export default function PharmacyFlagsRedirect(): never {
  redirect("/clinician/pharmacy");
}
