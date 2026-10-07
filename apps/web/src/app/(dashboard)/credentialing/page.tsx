import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";

export const dynamic = "force-dynamic";

/**
 * A role-aware doorway for notification links. A reviewer's bell links here because the same notice reaches an admin
 * (who works under /admin) and the Chief Medical Officer (whose account role is `clinician` and who works under
 * /clinician): neither can open the other's area, so one link would bounce one of them.
 */
export default async function CredentialingDoorway() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role === "admin") redirect("/admin/credentialing");
  if (profile.role === "clinician") redirect("/clinician/credentialing");
  redirect("/account/clinician");
}
