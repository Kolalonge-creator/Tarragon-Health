import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, View } from "react-native";
import type { MessageKey } from "@tarragon/i18n";
import {
  getAccessToken,
  leaveGroup,
  loadFeed,
  loadGroupView,
  loadHidden,
  setDigest,
  setGroupMuted,
  submitPost,
} from "@/lib/community/api";
import { fromSubmit, type ComposerEffect } from "@/lib/community/compose";
import { TEAM_ROLE_KEY, type FeedPost, type GroupView, type HiddenAuthor } from "@/lib/community/model";
import { space } from "@/ui/design";
import { AppText, Badge, Button, InlineAlert, Skeleton, SkeletonGroup } from "@/ui/kit";
import { Avatar, CheckRow, Section, Status, TextAction, formatDate, useCopy } from "./common";
import { Composer } from "./composer";
import { HiddenAuthors } from "./hidden-authors";
import { JoinForm } from "./join-form";
import { PostCard } from "./post-card";
import { QaCard } from "./qa-card";
import { SafetyCard } from "./safety-card";
import { uploadPost } from "./upload-post";

type Found = Extract<GroupView, { found: true }>;
type Loaded =
  | { state: "loading" }
  | { state: "failed" }
  | { state: "closed"; reason: string }
  | { state: "ready"; view: Found; posts: FeedPost[]; hasMore: boolean; feedFailed: boolean; hidden: HiddenAuthor[] };

/**
 * A group: the safety card first when there is one, then the not-medical-advice line, team prompts, the rules, the team, the doctor
 * question card, reviewed notes, the member's made-up name with mute, weekly note and leave, join, the box to write in, the feed, and the
 * people the member has hidden. No realtime and no polling: a write reloads the group.
 */
export function GroupDetail({
  slug,
  onOpenAppeals,
  onOpenEmergency,
  onOpenMessages,
}: {
  slug: string;
  onOpenAppeals: () => void;
  onOpenEmergency: () => void;
  onOpenMessages: () => void;
}) {
  const copy = useCopy();
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [safety, setSafety] = useState<"emergency" | "self_harm" | null>(null);
  const [joining, setJoining] = useState(false);
  const [older, setOlder] = useState<FeedPost[]>([]);
  const [olderHasMore, setOlderHasMore] = useState<boolean | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [feedMessage, setFeedMessage] = useState<MessageKey | null>(null);
  const [deletePosts, setDeletePosts] = useState(false);
  const [muted, setMuted] = useState(false);
  const [digest, setDigestOn] = useState(false);
  const [controlNote, setControlNote] = useState<MessageKey | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Reads the group, and for an active member the first page of posts and the hidden list. A reload keeps showing the old screen until it lands. */
  const reload = useCallback(async () => {
    const view = await loadGroupView(slug).catch(() => null);
    if (!alive.current) return;
    if (!view) {
      setLoaded({ state: "failed" });
      return;
    }
    if (!view.found) {
      setLoaded({ state: "closed", reason: view.reason });
      return;
    }
    let posts: FeedPost[] = [];
    let hasMore = false;
    let feedFailed = false;
    let hidden: HiddenAuthor[] = [];
    if (view.membership.status === "active") {
      const [feed, hiddenList, token] = await Promise.all([
        loadFeed(view.group.id).catch(() => null),
        loadHidden(view.group.id).catch(() => null),
        getAccessToken(),
      ]);
      if (!alive.current) return;
      if (feed && feed.ok) {
        posts = feed.posts;
        hasMore = feed.has_more;
      } else {
        feedFailed = true;
      }
      if (hiddenList && hiddenList.ok) hidden = hiddenList.hidden;
      setAccessToken(token);
    }
    setOlder([]);
    setOlderHasMore(null);
    setFeedMessage(feedFailed ? "community.feed.error" : null);
    setMuted(view.membership.status !== "none" && view.membership.notifications_muted);
    setDigestOn(view.membership.status !== "none" && view.membership.digest_opt_in === true);
    setLoaded({ state: "ready", view, posts, hasMore, feedFailed, hidden });
  }, [slug]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (loaded.state === "loading") {
    return (
      <SkeletonGroup label={copy("community.feed.loading")}>
        <Skeleton height={24} />
        <Skeleton height={96} />
        <Skeleton height={96} />
      </SkeletonGroup>
    );
  }
  if (loaded.state === "failed") {
    return (
      <View style={{ gap: space.md }}>
        <InlineAlert message={copy("community.not_open")} tone="info" />
        <Button title={copy("common.try_again")} onPress={() => void reload()} variant="secondary" fullWidth={false} />
      </View>
    );
  }
  if (loaded.state === "closed") {
    return <InlineAlert message={copy(loaded.reason === "adults_only" ? "community.adults_only" : "community.not_open")} tone="info" />;
  }

  const { view, posts: firstPosts, hasMore: firstHasMore, hidden } = loaded;
  const { group, membership, pinned, limits, team, prompts, qa } = view;
  const isMember = membership.status === "active";
  const readOnly = group.status === "read_only";
  const rulesCurrent = membership.status !== "none" && membership.rules_current;
  const canPost = isMember && !readOnly && rulesCurrent;
  const needsRules = isMember && !rulesCurrent && !readOnly;
  const notInGroup = membership.status === "none" || membership.status === "left";
  const isFull = group.full === true && notInGroup;
  const canJoin = !readOnly && notInGroup && !isFull;
  const blocked = membership.status === "suspended" || membership.status === "banned";
  const imagesAllowed = group.images_allowed === true;

  const known = new Set(firstPosts.map((p) => p.id));
  const posts = [...firstPosts, ...older.filter((p) => !known.has(p.id))];
  const hasMore = olderHasMore ?? firstHasMore;

  async function showOlder() {
    const last = posts[posts.length - 1];
    if (!last) return;
    setLoadingMore(true);
    setFeedMessage(null);
    const result = await loadFeed(group.id, last.created_at).catch(() => null);
    setLoadingMore(false);
    if (result && result.ok) {
      setOlder((o) => [...o, ...result.posts]);
      setOlderHasMore(result.has_more);
    } else {
      setFeedMessage("community.feed.error");
    }
  }

  function confirmLeave() {
    Alert.alert(copy("community.group.leave_confirm"), undefined, [
      { text: copy("community.group.leave"), style: "destructive", onPress: () => void leave() },
      { text: copy("common.cancel"), style: "cancel" },
    ]);
  }

  async function leave() {
    setControlNote(null);
    const result = await leaveGroup(group.id, deletePosts).catch(() => null);
    if (result && result.ok) {
      setDeletePosts(false);
      void reload();
    } else {
      setControlNote(result ? result.key : "community.compose.refused.other");
    }
  }

  async function toggleMute() {
    setControlNote(null);
    const result = await setGroupMuted(group.id, !muted).catch(() => null);
    if (result && result.ok) setMuted(result.muted);
    else setControlNote(result ? result.key : "community.compose.refused.other");
  }

  async function toggleDigest(on: boolean) {
    setControlNote(null);
    const result = await setDigest(group.id, on).catch(() => null);
    if (result && result.ok) setDigestOn(result.on);
    else setControlNote(result ? result.key : "community.compose.refused.other");
  }

  function afterPost(effect: ComposerEffect) {
    if (effect.safety) setSafety(effect.safety);
    if (effect.refresh) void reload();
  }

  return (
    <View style={{ gap: space.lg }}>
      {safety ? <SafetyCard kind={safety} onDismiss={() => setSafety(null)} onOpenEmergency={onOpenEmergency} onOpenMessages={onOpenMessages} /> : null}

      <InlineAlert message={copy("community.group.not_advice")} tone="info" />

      {prompts.length > 0 ? (
        <Section title={copy("community.group.prompt_title")}>
          {prompts.map((p) => (
            <AppText key={p.id} variant="body">
              {p.body}
            </AppText>
          ))}
        </Section>
      ) : null}

      <View style={{ gap: space.xs }}>
        {group.topic_label ? (
          <AppText variant="label" tone="textMuted" style={{ textTransform: "uppercase" }}>
            {group.topic_label}
          </AppText>
        ) : null}
        <AppText variant="headline" heading>
          {group.name}
        </AppText>
        <AppText variant="bodyLarge">{group.description}</AppText>
        {readOnly ? <AppText variant="bodyStrong">{copy("community.group.read_only")}</AppText> : null}
      </View>

      <Section title={copy("community.group.rules_title")}>
        <AppText variant="body">{group.rules_text}</AppText>
      </Section>

      <Section title={copy("community.group.team_title")}>
        {team.length === 0 ? (
          <AppText variant="body">{copy("community.group.team_default")}</AppText>
        ) : (
          team.map((m, i) => (
            <AppText key={`${m.scope}-${m.display_name}-${i}`} variant="body">
              {m.display_name} <AppText variant="body" tone="textMuted">{`(${copy(TEAM_ROLE_KEY[m.scope])})`}</AppText>
            </AppText>
          ))
        )}
      </Section>

      {qa ? <QaCard groupId={group.id} qa={qa} maxChars={limits.post_max_chars} canAsk={canPost} onAsked={() => void reload()} onSafety={setSafety} /> : null}

      {pinned.length > 0 ? (
        <View style={{ gap: space.md }}>
          <AppText variant="bodyStrong" heading>
            {copy("community.group.pinned_title")}
          </AppText>
          {pinned.map((note) => (
            <Section key={note.id} title={note.title}>
              <AppText variant="body">{note.body}</AppText>
              {/* Null-gated: shown only when the database returned both who reviewed it and when. */}
              {note.reviewed_by_name && note.reviewed_at ? (
                <AppText variant="caption" tone="textMuted">
                  {copy("community.group.reviewed_by", { name: note.reviewed_by_name, date: formatDate(note.reviewed_at) })}
                </AppText>
              ) : null}
            </Section>
          ))}
        </View>
      ) : null}

      {membership.status !== "none" && isMember ? (
        <View style={{ gap: space.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
            <Avatar code={membership.avatar_code} />
            <AppText variant="bodyStrong" style={{ flex: 1 }}>
              {copy("community.group.your_name", { handle: membership.handle })}
            </AppText>
          </View>
          <CheckRow label={copy("community.group.mute")} checked={muted} onChange={() => void toggleMute()} />
          <CheckRow label={copy("community.group.digest")} checked={digest} onChange={(on) => void toggleDigest(on)} />
          <CheckRow label={copy("community.group.leave_delete_posts")} checked={deletePosts} onChange={setDeletePosts} />
          <Button title={copy("community.group.leave")} onPress={confirmLeave} variant="secondary" fullWidth={false} />
        </View>
      ) : null}
      <Status text={controlNote ? copy(controlNote) : null} />

      {isFull ? <Badge label={copy("community.groups.full")} tone="neutral" /> : null}
      {blocked ? <InlineAlert message={copy(membership.status === "banned" ? "community.compose.refused.banned" : "community.compose.refused.suspended")} tone="warn" /> : null}

      {canJoin ? (
        joining ? (
          <JoinForm groupId={group.id} rulesText={group.rules_text} rulesVersion={group.rules_version} onJoined={() => void reload()} />
        ) : (
          <Button title={copy("community.group.join")} onPress={() => setJoining(true)} />
        )
      ) : null}
      {needsRules ? <JoinForm groupId={group.id} rulesText={group.rules_text} rulesVersion={group.rules_version} onJoined={() => void reload()} /> : null}

      {canPost ? (
        <Composer
          maxChars={limits.post_max_chars}
          label="community.post.placeholder"
          placeholder="community.post.placeholder"
          submitLabel="community.post.submit"
          imagesAllowed={imagesAllowed}
          submit={async ({ body, clientRequestId, image }) =>
            image && imagesAllowed
              ? uploadPost({ groupId: group.id, parentId: null, body, clientRequestId, image })
              : fromSubmit(await submitPost({ groupId: group.id, parentId: null, body, clientRequestId }))
          }
          onEffect={afterPost}
        />
      ) : null}

      {isMember ? (
        <View style={{ gap: space.md }}>
          {posts.length === 0 && !feedMessage ? (
            <AppText variant="body" tone="textMuted">
              {copy("community.feed.empty")}
            </AppText>
          ) : null}
          {posts.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              groupId={group.id}
              maxChars={limits.post_max_chars}
              editWindowMinutes={limits.edit_window_minutes}
              canPost={canPost}
              imagesAllowed={imagesAllowed}
              accessToken={accessToken}
              onChanged={() => void reload()}
              onHidden={() => {
                setControlNote("community.post.hide_done");
                void reload();
              }}
              onSafety={setSafety}
            />
          ))}
          <Status text={loadingMore ? copy("community.feed.loading") : feedMessage ? copy(feedMessage) : null} />
          {hasMore ? <Button title={copy("community.feed.more")} onPress={() => void showOlder()} variant="secondary" loading={loadingMore} /> : null}
        </View>
      ) : null}

      {isMember ? <HiddenAuthors hidden={hidden} onChanged={() => void reload()} /> : null}

      <TextAction label={copy("community.appeals.link")} onPress={onOpenAppeals} />
    </View>
  );
}
