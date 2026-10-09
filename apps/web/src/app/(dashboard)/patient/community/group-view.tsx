"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Locale } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatPatientDate } from "@/lib/format-date";
import type { FeedPost, GroupView as GroupViewData } from "@/lib/community/model";
import { Composer } from "./composer";
import { JoinSection } from "./join-section";
import { PostCard } from "./post-card";
import { SafetyCard } from "./safety-card";
import { AvatarBadge } from "./avatar-badge";
import { MUTED, TOUCH } from "./styles";
import { leaveGroup, loadFeed, setGroupMuted, submitPost } from "./community-actions";

type FoundView = Extract<GroupViewData, { found: true }>;

/**
 * A group: the safety card first when there is one, then the not-medical-advice banner, the rules, reviewed notes, the member's made-up
 * name, join or leave and mute controls, the box to write in, and the feed. No realtime and no polling: writes refresh the page.
 */
export function GroupView({
  view,
  initialPosts,
  initialHasMore,
  feedFailed,
  locale,
}: {
  view: FoundView;
  initialPosts: readonly FeedPost[];
  initialHasMore: boolean;
  feedFailed: boolean;
  locale: Locale;
}) {
  const router = useRouter();
  const { group, membership, pinned, limits } = view;
  const [safety, setSafety] = useState<"emergency" | "self_harm" | null>(null);
  const [joining, setJoining] = useState(false);
  const [older, setOlder] = useState<FeedPost[]>([]);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [feedMessage, setFeedMessage] = useState<"community.feed.error" | null>(feedFailed ? "community.feed.error" : null);
  const [deletePosts, setDeletePosts] = useState(false);
  const [muted, setMuted] = useState(membership.status !== "none" && membership.notifications_muted);
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
  const canJoin = !readOnly && (membership.status === "none" || membership.status === "left");
  const blocked = membership.status === "suspended" || membership.status === "banned";

  const known = new Set(initialPosts.map((p) => p.id));
  const posts = [...initialPosts, ...older.filter((p) => !known.has(p.id))];

  async function showOlder() {
    const last = posts[posts.length - 1];
    if (!last) return;
    setLoadingMore(true);
    setFeedMessage(null);
    const result = await loadFeed({ groupId: group.id, before: last.created_at }).catch(() => null);
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

  return (
    <div className="space-y-6">
      {safety ? <SafetyCard kind={safety} locale={locale} onDismiss={() => setSafety(null)} /> : null}

      <p className="rounded-lg border-l-4 border-brand-green bg-soft-sage p-3 text-sm font-medium dark:bg-brand-green/20">{t("community.group.not_advice", locale)}</p>

      <section className="space-y-2">
        {group.topic_label ? <p className={`text-xs font-medium uppercase tracking-wide ${MUTED}`}>{group.topic_label}</p> : null}
        <h2 className="font-heading text-xl font-semibold">{group.name}</h2>
        <p className="leading-relaxed">{group.description}</p>
        {readOnly ? <p className="font-medium">{t("community.group.read_only", locale)}</p> : null}
      </section>

      <section aria-labelledby="community-rules-title" className="space-y-2 rounded-xl border p-4">
        <h3 id="community-rules-title" className="font-medium">
          {t("community.group.rules_title", locale)}
        </h3>
        <p className="whitespace-pre-line text-sm leading-relaxed">{group.rules_text}</p>
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
      <p role="status" aria-live="polite" className="text-sm">
        {controlNote ? t(controlNote, locale) : ""}
      </p>

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
          />
        </section>
      ) : null}

      {isMember ? (
        <section className="space-y-4" aria-label={group.name}>
          {posts.length === 0 && !feedMessage ? <p className={MUTED}>{t("community.feed.empty", locale)}</p> : null}
          {posts.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              groupId={group.id}
              locale={locale}
              maxChars={limits.post_max_chars}
              editWindowMinutes={limits.edit_window_minutes}
              canPost={canPost}
              onChanged={refresh}
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
    </div>
  );
}
