import { ModerationDesk } from "@/components/community/moderation-desk";
import { CommunityNav } from "../community-nav";
import { requireAdmin } from "../load";
import { h1 } from "../ui";

export const metadata = { title: "Community moderation" };
export const dynamic = "force-dynamic";

/** The moderation and safety desk for an admin account. Every internal staff account holds a moderator grant automatically (COM-28). */
export default async function AdminCommunityModerationPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireAdmin();
  return (
    <div className="space-y-6">
      <h1 className={h1}>Community moderation</h1>
      <CommunityNav />
      <ModerationDesk requestedTab={(await searchParams).tab} basePath="/admin/community/moderation" />
    </div>
  );
}
