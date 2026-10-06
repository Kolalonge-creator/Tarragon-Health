import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { CredentialStatus } from "@/components/credentialing/credential-status";
import { Flash, Muted } from "@/components/credentialing/shared";
import { getMyCredentialStatus } from "@/lib/credentialing/queries";
import { firstParam, type SearchParams } from "@/lib/credentialing/params";

export const metadata = { title: "Training and profile" };
export const dynamic = "force-dynamic";

/** A clinician's own documents, expiry dates, level and what they are cleared for, plus renewal uploads. */
export default async function ClinicianCredentialsPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const sp = await searchParams;
  const status = await getMyCredentialStatus();

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Training and profile" description="Your documents, licence dates, level and what you are cleared for." />
      <Flash ok={firstParam(sp.ok)} error={firstParam(sp.error)} />
      {status ? (
        <CredentialStatus status={status} returnTo="/clinician/credentials" now={new Date()} />
      ) : (
        <Muted>There is no clinician record for your account yet. Your care team lead will add one.</Muted>
      )}
    </div>
  );
}
