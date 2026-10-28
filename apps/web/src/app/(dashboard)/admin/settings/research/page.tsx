import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { ResearchRegister } from "@/components/research/research-register";
import { loadAdminChallenges, loadExportRequests, loadProtocols } from "@/lib/research/load";
import { asNotice } from "@/lib/research/model";

export const metadata = { title: "Research protocols" };
export const dynamic = "force-dynamic";

/** S81: the data protection officer's view of the same register. An admin confirms; drafting and export belong to the Chief Medical Officer. */
export default async function AdminResearchPage({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const [loaded, requests] = await Promise.all([loadProtocols(), loadExportRequests()]);
  if (!loaded.ok && loaded.denied) redirect("/admin");
  const challenges = await loadAdminChallenges();
  return <ResearchRegister loaded={loaded} requests={requests} challenges={challenges} notice={asNotice((await searchParams).n)} showCreate={false} />;
}
