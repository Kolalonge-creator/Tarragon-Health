import Link from "next/link";
import { redirect } from "next/navigation";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SEMANTIC_ICON } from "@/lib/icons";
import { createClient } from "@/lib/supabase/server";
import { searchResultSchema } from "@/lib/community/model";
import { t } from "@tarragon/i18n";
import { LINK_BUTTON, MUTED, TOUCH } from "../styles";

export const metadata = { title: "Search your groups", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Search the posts in the groups the member has joined (COM-22). A plain GET form, so there is nothing to script and nothing is kept: the
 * words are sent to the database once, which only looks inside this member's own groups, skips people they hid and shows made-up names.
 */
export default async function CommunitySearchPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const { acting, profile, uiLanguage } = await getPatientDashboardContext();
  if (acting || profile.receives_care === false) redirect("/patient");

  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 80) ?? "";

  let content: React.ReactNode = null;
  if (q.length > 0 && q.length < 3) {
    content = <p role="status" className={MUTED}>{t("community.search.too_short", uiLanguage)}</p>;
  } else if (q.length >= 3) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("community_search_posts", { p_query: q });
    const parsed = error ? null : searchResultSchema.safeParse(data);
    if (!parsed || !parsed.success) {
      content = <p role="alert" className={MUTED}>{t("community.search.error", uiLanguage)}</p>;
    } else if (!parsed.data.ok) {
      content = <p role="status" className={MUTED}>{parsed.data.reason === "bad_query" ? t("community.search.too_short", uiLanguage) : t("community.not_open", uiLanguage)}</p>;
    } else if (parsed.data.items.length === 0) {
      content = <p role="status" className={MUTED}>{t("community.search.none", uiLanguage)}</p>;
    } else {
      content = (
        <div className="space-y-3">
          <ul className="space-y-3">
            {parsed.data.items.map((hit) => (
              <li key={hit.id} className="space-y-2 rounded-lg border border-charcoal-ink/15 p-4 dark:border-night-ink/25">
                <p className={`text-sm ${MUTED}`}>
                  {t(hit.is_reply ? "community.search.reply" : "community.search.post", uiLanguage)} {hit.group_name}
                  {". "}
                  {hit.author_handle}
                  {hit.is_mine ? ` ${t("community.search.mine", uiLanguage)}` : ""}
                </p>
                <p className="whitespace-pre-line break-words leading-relaxed">{hit.body}</p>
                <Link href={`/patient/community/${hit.group_slug}`} className={LINK_BUTTON}>
                  {t("community.search.open", uiLanguage)}
                </Link>
              </li>
            ))}
          </ul>
          {parsed.data.has_more ? <p className={`text-sm ${MUTED}`}>{t("community.search.more", uiLanguage)}</p> : null}
        </div>
      );
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("community.search.title", uiLanguage)}
        icon={SEMANTIC_ICON.family}
        backTo={{ href: "/patient/community", label: t("community.page.title", uiLanguage) }}
        description={t("community.search.help", uiLanguage)}
      />
      <form method="get" className="flex flex-wrap items-end gap-3" role="search">
        <div className="min-w-60 flex-1 space-y-1">
          <Label htmlFor="community-search-q">{t("community.search.label", uiLanguage)}</Label>
          <Input id="community-search-q" name="q" type="search" defaultValue={q} minLength={3} maxLength={80} autoComplete="off" />
        </div>
        <Button type="submit" className={TOUCH}>
          {t("community.search.button", uiLanguage)}
        </Button>
      </form>
      {content}
    </div>
  );
}
