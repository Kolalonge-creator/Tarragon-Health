import { useState } from "react";
import { Alert, Image, View } from "react-native";
import type { MessageKey } from "@tarragon/i18n";
import { API_BASE_URL } from "@/lib/api";
import { deletePost, editPost, hideAuthor, loadReplies, reactToPost, submitPost } from "@/lib/community/api";
import { fromSubmit, type ComposerEffect } from "@/lib/community/compose";
import { replyCountKey, withinEditWindow, type FeedPost } from "@/lib/community/model";
import { imageAspectRatio, imageSource } from "@/lib/community/upload";
import { uploadPost } from "./upload-post";
import { radii, space, useTheme } from "@/ui/design";
import { AppText, Badge } from "@/ui/kit";
import { Composer } from "./composer";
import { ReportForm } from "./report-form";
import { Avatar, Status, TextAction, formatDateTime, useCopy } from "./common";

export interface PostCardProps {
  post: FeedPost;
  groupId: string;
  maxChars: number;
  editWindowMinutes: number;
  /** True when the member is active in an open (not read-only) group with current rules. */
  canPost: boolean;
  /** The group allows one picture per post (every picture is checked by a moderator first). */
  imagesAllowed: boolean;
  /** The member's bearer token, for loading pictures. Null if there is no session; pictures then do not show. */
  accessToken: string | null;
  isReply?: boolean;
  onChanged: () => void;
  /** Called after the member hid this person; defaults to onChanged. */
  onHidden?: () => void;
  onSafety: (kind: "emergency" | "self_harm") => void;
}

/**
 * One post or reply. Shows the author's made-up name and preset picture only. Support, report, hide this person, reply (top-level posts),
 * and for the member's own posts edit (inside the window the group reports; the database enforces it too) and delete (asks first).
 * A question for the doctors carries a badge and, under it, the answers with each doctor's real name.
 */
export function PostCard({ post, groupId, maxChars, editWindowMinutes, canPost, imagesAllowed, accessToken, isReply = false, onChanged, onHidden, onSafety }: PostCardProps) {
  const copy = useCopy();
  const { colors } = useTheme();
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
  const canEdit = post.is_mine && canPost && !post.qa_session_id && withinEditWindow(post.created_at, editWindowMinutes, now);
  const isQuestion = !!post.qa_session_id;

  async function toggleSupport() {
    setNote(null);
    const result = await reactToPost(post.id, !supported).catch(() => null);
    if (!result || !result.ok) {
      setNote(result ? result.key : "community.compose.refused.other");
      return;
    }
    setSupported(result.supported);
    setSupportCount(result.supportCount);
  }

  async function fetchReplies() {
    setRepliesLoading(true);
    const result = await loadReplies(post.id).catch(() => null);
    setRepliesLoading(false);
    if (result && result.ok) setReplies(result.replies);
    else setNote("community.feed.error");
  }

  async function toggleReplies() {
    const next = !repliesOpen;
    setRepliesOpen(next);
    if (next && replies === null) await fetchReplies();
  }

  function confirmRemove() {
    Alert.alert(copy("community.post.delete_confirm"), undefined, [
      { text: copy("community.post.delete"), style: "destructive", onPress: () => void remove() },
      { text: copy("common.cancel"), style: "cancel" },
    ]);
  }

  async function remove() {
    const result = await deletePost(post.id).catch(() => null);
    if (result && result.ok) onChanged();
    else setNote(result ? result.key : "community.compose.refused.other");
  }

  async function hide() {
    setNote(null);
    const result = await hideAuthor(post.id).catch(() => null);
    if (result && result.ok) {
      setNote("community.post.hide_done");
      (onHidden ?? onChanged)();
    } else {
      setNote("community.post.hide_failed");
    }
  }

  function afterEdit(effect: ComposerEffect) {
    if (effect.safety) onSafety(effect.safety);
    if (effect.refresh) onChanged();
    if (effect.close) setEditing(false);
  }

  return (
    <View
      style={{ gap: space.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radii.lg, padding: space.lg }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <Avatar code={post.author_avatar} />
        <View style={{ flex: 1 }}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {post.author_handle}
            {post.is_mine ? ` (${copy("community.post.you")})` : ""}
          </AppText>
          <AppText variant="caption" tone="textMuted">
            {formatDateTime(post.created_at)}
            {post.edited_at ? ` - ${copy("community.post.edited")}` : ""}
          </AppText>
        </View>
      </View>

      {isQuestion ? <Badge label={copy("community.qa.question_badge")} tone="positive" /> : null}
      {post.pending_review ? (
        <AppText variant="body" tone="brandText">
          {copy("community.post.pending")}
        </AppText>
      ) : null}

      {editing ? (
        <Composer
          maxChars={maxChars}
          initialText={post.body}
          label="community.post.edit"
          submitLabel="community.post.save"
          submit={async ({ body }) => fromSubmit(await editPost(post.id, body))}
          onEffect={afterEdit}
        />
      ) : (
        <AppText variant="bodyLarge">{post.body}</AppText>
      )}

      {post.image && accessToken ? (
        <Image
          source={imageSource(API_BASE_URL, post.image.id, accessToken)}
          accessibilityLabel={copy("community.image.alt")}
          resizeMode="contain"
          style={{ width: "100%", aspectRatio: imageAspectRatio(post.image.width, post.image.height), borderRadius: radii.md, backgroundColor: colors.surfaceMuted }}
        />
      ) : null}

      {isQuestion ? (
        <View style={{ gap: space.sm }}>
          {post.answers.length === 0 ? (
            <AppText variant="body" tone="textMuted">
              {copy("community.qa.no_answers")}
            </AppText>
          ) : (
            post.answers.map((a) => (
              <View key={a.id} style={{ gap: space.xs, borderLeftWidth: 3, borderLeftColor: colors.brand, paddingLeft: space.md }}>
                <AppText variant="label" tone="brandText">
                  {copy("community.qa.answer_by", { name: a.doctor_name })}
                </AppText>
                <AppText variant="body">{a.body}</AppText>
              </View>
            ))
          )}
        </View>
      ) : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center" }}>
        {!post.pending_review ? (
          <TextAction
            label={`${supported ? copy("community.post.supported") : copy("community.post.support")} (${supportCount})`}
            selected={supported}
            onPress={() => void toggleSupport()}
          />
        ) : null}
        {!isReply && !isQuestion && !post.pending_review && (replyCount > 0 || canPost) ? (
          <TextAction
            label={`${replyCount > 0 ? `${copy(replyCountKey(replyCount), { count: replyCount })}: ` : ""}${repliesOpen ? copy("community.post.hide_replies") : copy("community.post.show_replies")}`}
            expanded={repliesOpen}
            onPress={() => void toggleReplies()}
          />
        ) : null}
        {canEdit && !editing ? <TextAction label={copy("community.post.edit")} onPress={() => setEditing(true)} /> : null}
        {post.is_mine ? (
          <TextAction label={copy("community.post.delete")} onPress={confirmRemove} tone="dangerText" />
        ) : (
          <>
            <TextAction label={copy("community.post.hide")} onPress={() => void hide()} tone="textMuted" />
            <TextAction label={copy("community.post.report")} expanded={reporting} onPress={() => setReporting((r) => !r)} tone="textMuted" />
          </>
        )}
      </View>

      <Status text={note ? copy(note) : null} />

      {reporting && !post.is_mine ? <ReportForm postId={post.id} /> : null}

      {repliesOpen ? (
        <View style={{ gap: space.md, borderLeftWidth: 2, borderLeftColor: colors.border, paddingLeft: space.md }}>
          {repliesLoading ? (
            <AppText variant="caption" tone="textMuted">
              {copy("community.feed.loading")}
            </AppText>
          ) : null}
          {(replies ?? []).map((r) => (
            <PostCard
              key={r.id}
              post={r}
              groupId={groupId}
              maxChars={maxChars}
              editWindowMinutes={editWindowMinutes}
              canPost={canPost}
              imagesAllowed={imagesAllowed}
              accessToken={accessToken}
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
              maxChars={maxChars}
              label="community.post.reply"
              submitLabel="community.post.reply"
              placeholder="community.post.reply_placeholder"
              imagesAllowed={imagesAllowed}
              submit={async ({ body, clientRequestId, image }) =>
                image
                  ? uploadPost({ groupId, parentId: post.id, body, clientRequestId, image })
                  : fromSubmit(await submitPost({ groupId, parentId: post.id, body, clientRequestId }))
              }
              onEffect={(effect) => {
                if (effect.safety) onSafety(effect.safety);
                if (effect.refresh) {
                  void fetchReplies();
                  onChanged();
                }
              }}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
