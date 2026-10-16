import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { ResearchRegister } from "@/components/research/research-register";
import { loadProtocols } from "@/lib/research/load";
import { asNotice } from "@/lib/research/model";

export const metadata = { title: "Research protocols" };
export const dynamic = "force-dynamic";

/** S81: the protocol register for the clinical lead (spec 26: "protocol register for the clinical lead"). */
export default async function ResearchPage({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const loaded = await loadProtocols();
  if (!loaded.ok && loaded.denied) redirect("/clinician");
  return <ResearchRegister loaded={loaded} notice={asNotice((await searchParams).n)} showCreate />;
}
