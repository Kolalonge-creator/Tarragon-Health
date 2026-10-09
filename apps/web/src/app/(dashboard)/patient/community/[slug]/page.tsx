import { notFound, redirect } from "next/navigation";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { createClient } from "@/lib/supabase/server";
import { feedSchema, groupViewSchema, type FeedPost } from "@/lib/community/model";
import { t } from "@tarragon/i18n";
import { GroupView } from "../group-view";
import { MUTED } from "../styles";

export const metadata = { title: "Community", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;

export default async function CommunityGroupPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SLUG.test(slug)) notFound();
  const { acting, profile, uiLanguage } = await getPatientDashboardContext();
  if (acting || profile.receives_care === false) redirect("/patient");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_get_group", { p_slug: slug });
  const parsed = error ? null : groupViewSchema.safeParse(data);
  const header = (
    <PageHeader title={t("community.page.title", uiLanguage)} icon={SEMANTIC_ICON.family} backTo={{ href: "/patient/community", label: t("community.page.title", uiLanguage) }} />
  );

  // Closed, under 18 or unreadable all show the same calm line; only a plain missing group is a 404.
  if (!parsed || !parsed.success) {
    return (
      <div className="space-y-6">
        {header}
        <p className={MUTED}>{t("community.not_open", uiLanguage)}</p>
      </div>
    );
  }
  const view = parsed.data;
  if (!view.found) {
    if (view.reason === "no_such_group") notFound();
    return (
      <div className="space-y-6">
        {header}
        <p className={MUTED}>{t(view.reason === "adults_only" ? "community.adults_only" : "community.not_open", uiLanguage)}</p>
      </div>
    );
  }

  // The feed is read only for an active member, as the database also requires.
  let posts: FeedPost[] = [];
  let hasMore = false;
  let feedFailed = false;
  if (view.membership.status === "active") {
    const { data: feedData, error: feedError } = await supabase.rpc("community_feed", { p_group_id: view.group.id });
    const feed = feedError ? null : feedSchema.safeParse(feedData);
    if (feed?.success && feed.data.ok) {
      posts = feed.data.posts;
      hasMore = feed.data.has_more;
    } else {
      feedFailed = true;
    }
  }

  return (
    <div className="space-y-6">
      {header}
      <GroupView view={view} initialPosts={posts} initialHasMore={hasMore} feedFailed={feedFailed} locale={uiLanguage} />
    </div>
  );
}
