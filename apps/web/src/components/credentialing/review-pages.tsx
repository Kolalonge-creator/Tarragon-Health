import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { getApplicationDetail, getContent, getExpiryOverview, getReviewQueue } from "@/lib/credentialing/queries";
import { firstParam, type SearchParams } from "@/lib/credentialing/params";
import { ApplicationReview } from "./application-review";
import { ContentManager } from "./content-manager";
import { CredentialingNav } from "./credentialing-nav";
import { ExpiryTable } from "./expiry-table";
import { QueueTable } from "./queue-table";
import { Flash } from "./shared";

/**
 * The reviewer pages, shared by the admin (/admin/credentialing) and the Chief Medical Officer
 * (/clinician/credentialing). A CMO's account role is always `clinician`, which cannot open /admin, so the same
 * pages are mounted under both. The route files do the role gate; the database re-checks every read and write.
 */
export async function QueuePage({ basePath, isCmo, searchParams }: { basePath: string; isCmo: boolean; searchParams: SearchParams }) {
  const sp = await searchParams;
  const rows = await getReviewQueue();
  return (
    <div className="space-y-5">
      <PageHeader title="Clinician applications" description="Check each applicant's licence, qualifications, identity and referees, then the Chief Medical Officer approves and you switch them on." />
      <CredentialingNav basePath={basePath} showContent={isCmo} />
      <Flash ok={firstParam(sp.ok)} error={firstParam(sp.error)} />
      <QueueTable rows={rows} basePath={basePath} />
    </div>
  );
}

export async function DetailPage({
  basePath,
  isCmo,
  applicationId,
  searchParams,
}: {
  basePath: string;
  isCmo: boolean;
  applicationId: string;
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const detail = await getApplicationDetail(applicationId);
  return (
    <div className="space-y-5">
      <PageHeader title="Review application" description="Opening a document is logged with your name." />
      <CredentialingNav basePath={basePath} showContent={isCmo} />
      <Link href={basePath} className="text-sm text-brand-green underline">
        Back to applications
      </Link>
      <Flash ok={firstParam(sp.ok)} error={firstParam(sp.error)} />
      <ApplicationReview detail={detail} returnTo={`${basePath}/${applicationId}`} isCmo={isCmo} />
    </div>
  );
}

export async function ExpiryPage({ basePath, isCmo, searchParams }: { basePath: string; isCmo: boolean; searchParams: SearchParams }) {
  const sp = await searchParams;
  const rows = await getExpiryOverview();
  return (
    <div className="space-y-5">
      <PageHeader
        title="Licences and cover"
        description="Everyone who works here, soonest expiry first. Clinicians are reminded three months before, a month before and on the day. An expired licence or cover pauses access unless a grace period is on record."
      />
      <CredentialingNav basePath={basePath} showContent={isCmo} />
      <Flash ok={firstParam(sp.ok)} error={firstParam(sp.error)} />
      <ExpiryTable rows={rows} returnTo={`${basePath}/expiry`} now={new Date()} />
    </div>
  );
}

export async function ContentPage({ basePath, searchParams }: { basePath: string; searchParams: SearchParams }) {
  const sp = await searchParams;
  const content = await getContent();
  return (
    <div className="space-y-5">
      <PageHeader title="Training and test content" description="You write and approve what new clinicians learn and are tested on. Nothing is used until you approve it." />
      <CredentialingNav basePath={basePath} showContent />
      <Flash ok={firstParam(sp.ok)} error={firstParam(sp.error)} />
      <ContentManager content={content} />
    </div>
  );
}
