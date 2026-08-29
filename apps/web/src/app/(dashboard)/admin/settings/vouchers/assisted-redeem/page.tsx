import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { AssistedRedeemForm } from "./assisted-redeem-form";

export default async function AssistedRedeemPage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role === "patient" || !profile.organisation_id) redirect("/admin");

  return <AssistedRedeemForm />;
}
