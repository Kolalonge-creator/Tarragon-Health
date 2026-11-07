import { redirect } from "next/navigation";
import { communityDeskQueueHref } from "@/components/community/community-nav";

export const dynamic = "force-dynamic";

/** Moved to the shared Community desk (decision COM-31, 2026-11-07). Kept so old links, bookmarks and notices still land. */
export default async function MovedToCommunityDesk({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  redirect(communityDeskQueueHref((await searchParams).tab));
}
