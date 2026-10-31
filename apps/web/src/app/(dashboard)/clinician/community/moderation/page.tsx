import { ModerationDesk } from "@/components/community/moderation-desk";

export const metadata = { title: "Community" };
export const dynamic = "force-dynamic";

export default async function ClinicianCommunityModerationPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  return <ModerationDesk requestedTab={(await searchParams).tab} basePath="/clinician/community/moderation" />;
}
