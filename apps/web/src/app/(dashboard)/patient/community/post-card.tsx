"use client";

import { useState } from "react";
import { t, type Locale, type MessageKey } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { formatPatientDateTime } from "@/lib/format-date";
import { replyCountKey, type FeedPost } from "@/lib/community/model";
import { AvatarBadge } from "./avatar-badge";
import { Composer } from "./composer";
import { ReportForm } from "./report-form";
import { MUTED, TOUCH } from "./styles";
import { deletePost, editPost, hideAuthor, loadReplies, reactToPost, submitPost } from "./community-actions";

/**
 * One post or reply. Shows the author's made-up name and preset picture only. Support, report, reply (top-level posts), and for the
 * member's own posts edit (inside the window the group reports; the database enforces it too) and delete (asks first).
 */
export function PostCard({
  post,
  groupId,
  locale,
  maxChars,
  editWindowMinutes,
  canPost,
  isReply = false,
  onChanged,
  onHidden,
  onSafety,
}: {
  post: FeedPost;
  groupId: string;
  locale: Locale;
  maxChars: number;
  editWindowMinutes: number;
  /** True when the member is active in an open (not read-only) group. */
  canPost: boolean;
  isReply?: boolean;
  onChanged: () => void;
  /** Called after the member hid this person; defaults to onChanged. */
  onHidden?: () => void;
  onSafety: (kind: "emergency" | "self_harm") => void;
}) {
  const [supported, setSupported] = useState(post.i_supported);
  const [supportCount, setSupportCount] = useState(post.support_count);
  const [note, setNote] = useState<MessageKey | null>(null);
  const [editing, setEditing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [repliesOpen, setRepliesOpen] = useState(false);
  const [replies, setReplies] = useState<FeedPost[] | null>(null);
  const [repliesLoading, setRepliesLoading] = useState(false);
  const [now] = useState(() => Date.now());

  const replyCount = post.reply_count ?? 0;
  const withinEditWindow = now - new Date(post.created_at).getTime() <= editWindowMinutes * 60_000;
  const canEdit = post.is_mine && canPost && withinEditWindow;

  async function toggleSupport() {
    setNote(null);
    const result = await reactToPost({ postId: post.id, on: !supported }).catch(() => null);
    if (!result || !result.ok) {
      setNote(result ? result.key : "community.compose.refused.other");
      return;
    }
    setSupported(result.supported);
    setSupportCount(result.supportCount);
  }

  async function fetchReplies() {
    setRepliesLoading(true);
    const result = await loadReplies({ postId: post.id }).catch(() => null);
    setRepliesLoading(false);
    if (result && "replies" in result && result.ok) setReplies(result.replies);
    else setNote("community.feed.error");
  }

  async function toggleReplies() {
    const next = !repliesOpen;
    setRepliesOpen(next);
    if (next && replies === null) await fetchReplies();
  }

  async function remove() {
    if (!window.confirm(t("community.post.delete_confirm", locale))) return;
    const result = await deletePost({ postId: post.id }).catch(() => null);
    if (result && result.ok) onChanged();
    else setNote(result ? result.key : "community.compose.refused.other");
  }

  async function hide() {
    setNote(null);
    const result = await hideAuthor({ postId: post.id }).catch(() => null);
    if (result && result.ok) {
      setNote("community.post.hide_done");
      (onHidden ?? onChanged)();
    } else {
      setNote("community.post.hide_failed");
    }
  }

  return (
    <article className="space-y-3 rounded-xl border p-4" aria-label={post.author_handle}>
      <header className="flex items-center gap-3">
        <AvatarBadge code={post.author_avatar} />
        <div className="min-w-0">
          <p className="truncate font-medium">
            {post.author_handle}
            {post.is_mine ? <span className={`ml-2 text-sm font-normal ${MUTED}`}>({t("community.post.you", locale)})</span> : null}
          </p>
          <p className={`text-sm ${MUTED}`}>
            <time dateTime={post.created_at}>{formatPatientDateTime(post.created_at)}</time>
            {post.edited_at ? <span> - {t("community.post.edited", locale)}</span> : null}
          </p>
        </div>
      </header>

      {post.pending_review ? <p className="rounded-md bg-soft-sage p-2 text-sm dark:bg-brand-green/20">{t("community.post.pending", locale)}</p> : null}

      {editing ? (
        <Composer
          locale={locale}
          maxChars={maxChars}
          initialText={post.body}
          label="community.post.edit"
          submitLabel="community.post.save"
          submit={(body) => editPost({ postId: post.id, body })}
          onPublished={onChanged}
          onSafety={onSafety}
          onClose={() => setEditing(false)}
        />
      ) : (
        <p className="whitespace-pre-line break-words leading-relaxed">{post.body}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!post.pending_review ? (
          <Button type="button" variant="outline" className={TOUCH} aria-pressed={supported} onClick={toggleSupport}>
            {supported ? t("community.post.supported", locale) : t("community.post.support", locale)} ({supportCount})
          </Button>
        ) : null}
        {!isReply && !post.pending_review && (replyCount > 0 || canPost) ? (
          <Button type="button" variant="ghost" className={TOUCH} aria-expanded={repliesOpen} onClick={toggleReplies}>
            {replyCount > 0 ? `${t(replyCountKey(replyCount), locale, { count: replyCount })}: ` : ""}
            {repliesOpen ? t("community.post.hide_replies", locale) : t("community.post.show_replies", locale)}
          </Button>
        ) : null}
        {canEdit && !editing ? (
          <Button type="button" variant="ghost" className={TOUCH} onClick={() => setEditing(true)}>
            {t("community.post.edit", locale)}
          </Button>
        ) : null}
        {post.is_mine ? (
          <Button type="button" variant="ghost" className={TOUCH} onClick={remove}>
            {t("community.post.delete", locale)}
          </Button>
        ) : (
          <>
            <Button type="button" variant="ghost" className={TOUCH} onClick={hide}>
              {t("community.post.hide", locale)}
            </Button>
            <Button type="button" variant="ghost" className={TOUCH} aria-expanded={reporting} onClick={() => setReporting((r) => !r)}>
              {t("community.post.report", locale)}
            </Button>
          </>
        )}
      </div>

      <p role="status" aria-live="polite" className="text-sm">
        {note ? t(note, locale) : ""}
      </p>

      {reporting && !post.is_mine ? <ReportForm postId={post.id} locale={locale} /> : null}

      {repliesOpen ? (
        <div className="space-y-3 border-l-2 pl-4">
          {repliesLoading ? <p className={`text-sm ${MUTED}`}>{t("community.feed.loading", locale)}</p> : null}
          {(replies ?? []).map((r) => (
            <PostCard
              key={r.id}
              post={r}
              groupId={groupId}
              locale={locale}
              maxChars={maxChars}
              editWindowMinutes={editWindowMinutes}
              canPost={canPost}
              isReply
              onChanged={() => {
                void fetchReplies();
                onChanged();
              }}
              onHidden={() => {
                void fetchReplies();
                (onHidden ?? onChanged)();
              }}
              onSafety={onSafety}
            />
          ))}
          {canPost ? (
            <Composer
              locale={locale}
              maxChars={maxChars}
              label="community.post.reply"
              submitLabel="community.post.reply"
              placeholder="community.post.reply_placeholder"
              submit={(body, clientRequestId) => submitPost({ groupId, parentId: post.id, body, clientRequestId })}
              onPublished={() => {
                void fetchReplies();
                onChanged();
              }}
              onSafety={onSafety}
            />
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
