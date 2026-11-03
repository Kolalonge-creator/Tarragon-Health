import { ModerationDesk } from "@/components/community/moderation-desk";

export const metadata = { title: "Community" };
export const dynamic = "force-dynamic";

/** The moderation desk for an analyst account (the CEO's console). Internal staff moderate automatically; an admin can withdraw it (COM-28). */
export default async function AnalystCommunityPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  return <ModerationDesk requestedTab={(await searchParams).tab} basePath="/analytics/community" />;
}
