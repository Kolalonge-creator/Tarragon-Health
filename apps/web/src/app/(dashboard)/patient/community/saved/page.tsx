import Link from "next/link";
import { redirect } from "next/navigation";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { createClient } from "@/lib/supabase/server";
import { formatPatientDateTime } from "@/lib/format-date";
import { replyCountKey, savedListSchema } from "@/lib/community/model";
import { t } from "@tarragon/i18n";
import { LINK_BUTTON, MUTED } from "../styles";
import { UnsaveButton } from "./unsave-button";

export const metadata = { title: "Saved posts", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/;

/**
 * The member's saved posts, newest save first. Private: nobody else is told what a member saved. A post drops out of this list while the
 * member is no longer in its group, has hidden its author, or it is no longer visible; it comes back if that changes. Paged with a plain
 * GET link (`before` is the saved_at of the last post shown), so there is nothing to script.
 */
export default async function CommunitySavedPage({ searchParams }: { searchParams: Promise<{ before?: string | string[] }> }) {
  const { acting, profile, uiLanguage } = await getPatientDashboardContext();
  if (acting || profile.receives_care === false) redirect("/patient");

  const raw = (await searchParams).before;
  const before = Array.isArray(raw) ? raw[0] : raw;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_saved_list", before && ISO.test(before) ? { p_before: before } : {});
  const parsed = error ? null : savedListSchema.safeParse(data);

  let content: React.ReactNode;
  if (!parsed || !parsed.success || !parsed.data.ok) {
    content = (
      <p role="alert" className={MUTED}>
        {t("community.feed.error", uiLanguage)}
      </p>
    );
  } else if (parsed.data.posts.length === 0) {
    content = <p className={MUTED}>{t(before ? "community.saved.no_more" : "community.saved.empty", uiLanguage)}</p>;
  } else {
    const posts = parsed.data.posts;
    const last = posts[posts.length - 1];
    content = (
      <div className="space-y-3">
        <ul className="space-y-3">
          {posts.map((post) => {
            const replies = post.reply_count;
            return (
              <li key={post.id} className="space-y-2 rounded-lg border border-charcoal-ink/15 p-4 dark:border-night-ink/25">
                <p className={`text-sm ${MUTED}`}>
                  {post.group_name}. {post.author_handle}
                  {post.is_mine ? ` ${t("community.search.mine", uiLanguage)}` : ""}. {formatPatientDateTime(post.created_at)}
                </p>
                <p className="whitespace-pre-line break-words leading-relaxed">{post.body}</p>
                {post.pending_review ? <p className={`text-sm ${MUTED}`}>{t("community.saved.waiting", uiLanguage)}</p> : null}
                <div className="flex flex-wrap items-center gap-3">
                  <Link href={`/patient/community/${post.group_slug}`} className={LINK_BUTTON}>
                    {t("community.search.open", uiLanguage)}
                  </Link>
                  {replies > 0 ? <span className={`text-sm ${MUTED}`}>{t(replyCountKey(replies), uiLanguage, { count: replies })}</span> : null}
                  <UnsaveButton postId={post.id} locale={uiLanguage} />
                </div>
              </li>
            );
          })}
        </ul>
        {parsed.data.has_more && last ? (
          <Link href={`/patient/community/saved?before=${encodeURIComponent(last.saved_at)}`} className={LINK_BUTTON}>
            {t("community.feed.more", uiLanguage)}
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("community.saved.title", uiLanguage)}
        icon={SEMANTIC_ICON.family}
        backTo={{ href: "/patient/community", label: t("community.page.title", uiLanguage) }}
        description={t("community.saved.help", uiLanguage)}
      />
      {content}
    </div>
  );
}
