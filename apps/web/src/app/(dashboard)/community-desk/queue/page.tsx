import { ModerationDesk } from "@/components/community/moderation-desk";

export const metadata = { title: "Moderation worklist · Community desk" };
export const dynamic = "force-dynamic";

/** The moderation and safety queues on the shared desk. The old per-role pages redirect here (COM-31). */
export default async function CommunityDeskQueuePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  return <ModerationDesk requestedTab={(await searchParams).tab} basePath="/community-desk/queue" />;
}
