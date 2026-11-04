"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { t, type Locale, type MessageKey } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatPatientDate } from "@/lib/format-date";
import { GROUP_READING, type FeedPost, type FeedSort, type GroupView as GroupViewData } from "@/lib/community/model";
import { HEALTH_EDUCATION_CATEGORIES } from "@/lib/queries/health-education";
import { Composer } from "./composer";
import { JoinSection } from "./join-section";
import { PostCard } from "./post-card";
import { SafetyCard } from "./safety-card";
import { QaCard } from "./qa-card";
import { HiddenAuthors, type HiddenAuthor } from "./hidden-authors";
import { AvatarBadge } from "./avatar-badge";
import { MUTED, TOUCH } from "./styles";
import { leaveGroup, loadFeed, setDigest, setGroupMuted, submitPost } from "./community-actions";

type FoundView = Extract<GroupViewData, { found: true }>;

const LINK = "inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";

const TEAM_ROLE: Record<"moderator" | "safety_reviewer", MessageKey> = {
  moderator: "community.team.moderator",
  safety_reviewer: "community.team.safety_reviewer",
};

/**
 * A group: the safety card first when there is one, then the not-medical-advice banner, the rules, reviewed notes, the member's made-up
 * name, join or leave and mute controls, the box to write in, and the feed. No realtime and no polling: writes refresh the page.
 * The feed has two orders (`sort`, from the URL so a reload keeps it): latest (pages with "show older") and most discussed (one page).
 * "For your own health" points to the private care-team messages, the private document upload and this group's reading in the library:
 * the group is never the place for one person's results or questions.
 */
export function GroupView({
  view,
  initialPosts,
  initialHasMore,
  feedFailed,
  hidden = [],
  sort = "latest",
  locale,
}: {
  view: FoundView;
  initialPosts: readonly FeedPost[];
  initialHasMore: boolean;
  feedFailed: boolean;
  /** People this member has hidden in this group (handles only). */
  hidden?: readonly HiddenAuthor[];
  /** The feed's order; the server already loaded `initialPosts` in it. */
  sort?: FeedSort;
  locale: Locale;
}) {
  const router = useRouter();
  const { group, membership, pinned, limits, team, prompts, qa } = view;
  const [safety, setSafety] = useState<"emergency" | "self_harm" | null>(null);
  const [joining, setJoining] = useState(false);
  const [older, setOlder] = useState<FeedPost[]>([]);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [feedMessage, setFeedMessage] = useState<"community.feed.error" | null>(feedFailed ? "community.feed.error" : null);
  const [deletePosts, setDeletePosts] = useState(false);
  const [muted, setMuted] = useState(membership.status !== "none" && membership.notifications_muted);
  const [digest, setDigestOn] = useState(membership.status !== "none" && membership.digest_opt_in === true);
  const [controlNote, setControlNote] = useState<Parameters<typeof t>[0] | null>(null);

  // Older posts loaded by "show older" would go stale after an edit or delete, so a refresh starts the list again.
  const refresh = () => {
    setOlder([]);
    setHasMore(initialHasMore);
    router.refresh();
  };
  const isMember = membership.status === "active";
  const readOnly = group.status === "read_only";
  const canPost = isMember && !readOnly && membership.rules_current;
  const needsRules = isMember && !membership.rules_current && !readOnly;
  const notInGroup = membership.status === "none" || membership.status === "left";
  const isFull = group.full === true && notInGroup;
  const canJoin = !readOnly && notInGroup && !isFull;
  const blocked = membership.status === "suspended" || membership.status === "banned";

  const reading = (GROUP_READING[group.slug] ?? []).flatMap((code) => HEALTH_EDUCATION_CATEGORIES.filter((c) => c.value === code));

  const known = new Set(initialPosts.map((p) => p.id));
  const posts = [...initialPosts, ...older.filter((p) => !known.has(p.id))];

  async function showOlder() {
    const last = posts[posts.length - 1];
    if (!last) return;
    setLoadingMore(true);
    setFeedMessage(null);
    const result = await loadFeed({ groupId: group.id, before: last.created_at, sort }).catch(() => null);
    setLoadingMore(false);
    if (result && result.ok && "posts" in result) {
      setOlder((o) => [...o, ...result.posts]);
      setHasMore(result.has_more);
    } else {
      setFeedMessage("community.feed.error");
    }
  }

  async function leave() {
    if (!window.confirm(t("community.group.leave_confirm", locale))) return;
    const result = await leaveGroup({ groupId: group.id, deletePosts }).catch(() => null);
    if (result && result.ok) refresh();
    else setControlNote(result ? result.key : "community.compose.refused.other");
  }

  async function toggleMute() {
    setControlNote(null);
    const result = await setGroupMuted({ groupId: group.id, muted: !muted }).catch(() => null);
    if (result && result.ok) setMuted(result.muted);
    else setControlNote(result ? result.key : "community.compose.refused.other");
  }

  async function toggleDigest(on: boolean) {
    setControlNote(null);
    const result = await setDigest({ groupId: group.id, on }).catch(() => null);
    if (result && result.ok) setDigestOn(result.on);
    else setControlNote(result ? result.key : "community.compose.refused.other");
  }

  return (
    <div className="space-y-6">
      {safety ? <SafetyCard kind={safety} locale={locale} onDismiss={() => setSafety(null)} /> : null}

      <p className="rounded-lg border-l-4 border-brand-green bg-soft-sage p-3 text-sm font-medium dark:bg-brand-green/20">{t("community.group.not_advice", locale)}</p>

      {prompts.length > 0 ? (
        <section aria-labelledby="community-prompts-title" className="space-y-2 rounded-xl border p-4">
          <h3 id="community-prompts-title" className="font-medium">
            {t("community.group.prompt_title", locale)}
          </h3>
          <ul className="space-y-1">
            {prompts.map((p) => (
              <li key={p.id} className="whitespace-pre-line text-sm leading-relaxed">
                {p.body}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-2">
        {group.topic_label ? <p className={`text-xs font-medium uppercase tracking-wide ${MUTED}`}>{group.topic_label}</p> : null}
        <h2 className="font-heading text-xl font-semibold">{group.name}</h2>
        <p className="leading-relaxed">{group.description}</p>
        {readOnly ? <p className="font-medium">{t("community.group.read_only", locale)}</p> : null}
      </section>

      {qa ? <QaCard qa={qa} groupId={group.id} locale={locale} canAsk={canPost} onSafety={setSafety} onAsked={refresh} /> : null}

      <section aria-labelledby="community-rules-title" className="space-y-2 rounded-xl border p-4">
        <h3 id="community-rules-title" className="font-medium">
          {t("community.group.rules_title", locale)}
        </h3>
        <p className="whitespace-pre-line text-sm leading-relaxed">{group.rules_text}</p>
      </section>

      <section aria-labelledby="community-team-title" className="space-y-1">
        <h3 id="community-team-title" className="font-medium">
          {t("community.group.team_title", locale)}
        </h3>
        {team.length === 0 ? (
          <p className="text-sm">{t("community.group.team_default", locale)}</p>
        ) : (
          <ul className="text-sm">
            {team.map((m, i) => (
              <li key={`${m.scope}-${m.display_name}-${i}`}>
                {m.display_name} <span className={MUTED}>({t(TEAM_ROLE[m.scope], locale)})</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="community-care-title" className="space-y-2 rounded-xl border p-4">
        <h3 id="community-care-title" className="font-medium">
          {t("community.group.care_title", locale)}
        </h3>
        <p className="text-sm leading-relaxed">{t("community.group.care_body", locale)}</p>
        <ul className="flex flex-wrap gap-x-4">
          <li>
            <Link href="/patient/messages" className={LINK}>
              {t("community.group.care_messages", locale)}
            </Link>
          </li>
          <li>
            <Link href="/patient/documents" className={LINK}>
              {t("community.group.care_documents", locale)}
            </Link>
          </li>
        </ul>
        <p className="pt-2 text-sm font-medium">{t("community.group.reading_title", locale)}</p>
        <ul className="flex flex-wrap gap-x-4" data-testid="community-reading">
          {reading.map((r) => (
            <li key={r.value}>
              <Link href={`/patient/learn?category=${r.value}#learn-library`} className={LINK}>
                {r.label}
              </Link>
            </li>
          ))}
          <li>
            <Link href="/patient/learn" className={LINK}>
              {t("community.group.reading_all", locale)}
            </Link>
          </li>
        </ul>
      </section>

      {pinned.length > 0 ? (
        <section aria-labelledby="community-pinned-title" className="space-y-3">
          <h3 id="community-pinned-title" className="font-medium">
            {t("community.group.pinned_title", locale)}
          </h3>
          {pinned.map((note) => (
            <article key={note.id} className="space-y-1 rounded-xl border p-4">
              <h4 className="font-medium">{note.title}</h4>
              <p className="whitespace-pre-line text-sm leading-relaxed">{note.body}</p>
              {/* Null-gated: shown only when the database returned both who reviewed it and when. */}
              {note.reviewed_by_name && note.reviewed_at ? (
                <p className={`text-xs ${MUTED}`}>
                  {t("community.group.reviewed_by", locale, { name: note.reviewed_by_name, date: formatPatientDate(note.reviewed_at) })}
                </p>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}

      {membership.status !== "none" && isMember && membership.new_member ? (
        <section aria-labelledby="community-welcome-title" className="space-y-1 rounded-lg border border-brand-green/30 bg-soft-sage p-4 dark:bg-brand-green/20">
          <h2 id="community-welcome-title" className="font-heading text-base font-semibold">
            {t("community.welcome.title", locale)}
          </h2>
          <p className="text-sm leading-relaxed">{t("community.welcome.body", locale)}</p>
        </section>
      ) : null}

      {membership.status !== "none" && isMember ? (
        <section className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-3 font-medium">
            <AvatarBadge code={membership.avatar_code} />
            <span>{t("community.group.your_name", locale, { handle: membership.handle })}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" className={TOUCH} onClick={toggleMute}>
              {muted ? t("community.group.unmute", locale) : t("community.group.mute", locale)}
            </Button>
            <div className={`flex items-center gap-2 ${TOUCH}`}>
              <input id="community-leave-delete" type="checkbox" className="h-5 w-5" checked={deletePosts} onChange={(e) => setDeletePosts(e.target.checked)} />
              <Label htmlFor="community-leave-delete" className="font-normal">
                {t("community.group.leave_delete_posts", locale)}
              </Label>
            </div>
            <Button type="button" variant="outline" className={TOUCH} onClick={leave}>
              {t("community.group.leave", locale)}
            </Button>
          </div>
        </section>
      ) : null}
      {isMember ? (
        <div className={`flex items-center gap-3 ${TOUCH}`}>
          <input id="community-digest" type="checkbox" className="h-5 w-5" checked={digest} onChange={(e) => void toggleDigest(e.target.checked)} />
          <Label htmlFor="community-digest" className="font-normal">
            {t("community.group.digest", locale)}
          </Label>
        </div>
      ) : null}
      <p role="status" aria-live="polite" className="text-sm">
        {controlNote ? t(controlNote, locale) : ""}
      </p>

      {isFull ? (
        <p>
          <span className="inline-flex min-h-11 items-center rounded-md bg-soft-sage px-3 text-sm font-medium dark:bg-brand-green/20">{t("community.groups.full", locale)}</span>
        </p>
      ) : null}

      {blocked ? <p>{t(membership.status === "banned" ? "community.compose.refused.banned" : "community.compose.refused.suspended", locale)}</p> : null}

      {canJoin ? (
        joining ? (
          <JoinSection
            groupId={group.id}
            rulesText={group.rules_text}
            rulesVersion={group.rules_version}
            locale={locale}
            onJoined={() => {
              refresh();
            }}
          />
        ) : (
          <Button type="button" className={TOUCH} onClick={() => setJoining(true)}>
            {t("community.group.join", locale)}
          </Button>
        )
      ) : null}

      {needsRules ? (
        <JoinSection groupId={group.id} rulesText={group.rules_text} rulesVersion={group.rules_version} locale={locale} onJoined={refresh} />
      ) : null}

      {canPost ? (
        <section aria-label={t("community.post.submit", locale)}>
          <Composer
            locale={locale}
            maxChars={limits.post_max_chars}
            label="community.post.placeholder"
            placeholder="community.post.placeholder"
            submitLabel="community.post.submit"
            submit={(body, clientRequestId) => submitPost({ groupId: group.id, parentId: null, body, clientRequestId })}
            onPublished={refresh}
            onSafety={setSafety}
            picture={group.images_allowed === true ? { groupId: group.id, parentId: null, maxBytes: limits.image_max_bytes ?? 4 * 1024 * 1024 } : undefined}
          />
        </section>
      ) : null}

      {isMember ? (
        <section className="space-y-4" aria-label={group.name}>
          <nav aria-label={t("community.sort.label", locale)} className="flex flex-wrap items-center gap-2">
            {(["latest", "discussed"] as const).map((key) => (
              <Link
                key={key}
                href={key === "latest" ? `/patient/community/${group.slug}` : `/patient/community/${group.slug}?sort=${key}`}
                aria-current={sort === key ? "page" : undefined}
                scroll={false}
                className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green ${
                  sort === key ? "border-brand-green bg-brand-green text-white" : "border-charcoal-ink/20"
                }`}
              >
                {t(key === "latest" ? "community.sort.latest" : "community.sort.discussed", locale)}
              </Link>
            ))}
          </nav>
          <Link href="/patient/community/saved" className={LINK}>
            {t("community.saved.link", locale)}
          </Link>
          {sort === "discussed" ? <p className={`text-sm ${MUTED}`}>{t("community.sort.discussed_note", locale)}</p> : null}
          {posts.length === 0 && !feedMessage ? <p className={MUTED}>{t(sort === "discussed" ? "community.sort.discussed_empty" : "community.feed.empty", locale)}</p> : null}
          {posts.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              groupId={group.id}
              locale={locale}
              maxChars={limits.post_max_chars}
              editWindowMinutes={limits.edit_window_minutes}
              canPost={canPost}
              imagesAllowed={group.images_allowed === true}
              imageMaxBytes={limits.image_max_bytes}
              qaStatus={qa ? qa.status : null}
              onChanged={refresh}
              onHidden={() => {
                setControlNote("community.post.hide_done");
                refresh();
              }}
              onSafety={setSafety}
            />
          ))}
          <p role="status" aria-live="polite" className="text-sm">
            {loadingMore ? t("community.feed.loading", locale) : feedMessage ? t(feedMessage, locale) : ""}
          </p>
          {hasMore ? (
            <Button type="button" variant="outline" className={TOUCH} onClick={showOlder} disabled={loadingMore}>
              {t("community.feed.more", locale)}
            </Button>
          ) : null}
        </section>
      ) : null}

      {isMember ? <HiddenAuthors hidden={hidden} locale={locale} onChanged={refresh} /> : null}

      <footer>
        <Link href="/patient/community/appeals" className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green">
          {t("community.appeals.link", locale)}
        </Link>
      </footer>
    </div>
  );
}
