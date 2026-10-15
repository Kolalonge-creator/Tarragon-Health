import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { CreatorCredentialsForm } from "./creator-credentials-form";

export const metadata = { title: "Learning creator credentials" };

export default async function LearningCreatorPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "clinician") redirect("/clinician");
  return (
    <div className="space-y-6">
      <PageHeader
        title="Learning creator credentials"
        description="If you were invited to write for the Learning Centre, send your MDCN number and evidence of your credentials here. An admin verifies them. Everything you write is still clinically reviewed before it is published, and is credited to you by name."
        backTo={{ href: "/clinician", label: "Dashboard" }}
      />
      <CreatorCredentialsForm />
    </div>
  );
}
