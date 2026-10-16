import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { FireDrillsPage } from "@/components/capacity/fire-drills-page";

export const metadata = { title: "Fire drills" };
export const dynamic = "force-dynamic";

export default async function AdminFireDrills() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  return <FireDrillsPage />;
}
