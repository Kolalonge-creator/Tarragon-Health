import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { SymptomSafetyPage } from "@/components/symptom/symptom-safety-page";

export const metadata = { title: "Symptom checker safety" };
export const dynamic = "force-dynamic";

/** S60: the symptom checker safety page for an admin. Reads and writes are refused by the database for anyone else. */
export default async function AdminSymptomSafety({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/");
  return <SymptomSafetyPage viewer="admin" outcome={(await searchParams).r} />;
}
