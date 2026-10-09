import { useCallback, useEffect, useState } from "react";
import { BackHandler, View } from "react-native";
import type { MessageKey } from "@tarragon/i18n";
import { loadGroupList, loadMyActions, searchGroups } from "@/lib/community/api";
import { communityGate } from "@/lib/community/entry";
import { isSearchQuery, memberCountKey, type GroupList, type GroupSummary, type MyActions } from "@/lib/community/model";
import type { SectionId } from "@/lib/sections";
import { space, useTheme } from "@/ui/design";
import { AppText, Badge, Button, Card, Field, InlineAlert, Screen, Skeleton, SkeletonGroup } from "@/ui/kit";
import { AppealsView } from "./appeals-view";
import { Status, TextAction, useCopy } from "./common";
import { GroupDetail } from "./group-detail";

type Route = { view: "list" } | { view: "group"; slug: string } | { view: "appeals" };

/**
 * Community: members-only topic groups (docs/COMMUNITY_SPEC.md). The menu entry only exists while Community is open for an adult with
 * their own account (home-shell.tsx); this screen still says one calm line if it is reached any other way. Other members are only ever
 * made-up names. No notification has to succeed for any of it to work.
 */
export function CommunityScreen({ onNavigate }: { onNavigate: (section: SectionId) => void }) {
  const copy = useCopy();
  const [route, setRoute] = useState<Route>({ view: "list" });

  // The phone's back button steps out of a group or the decisions page before it leaves Community.
  useEffect(() => {
    if (route.view === "list") return undefined;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setRoute({ view: "list" });
      return true;
    });
    return () => sub.remove();
  }, [route.view]);

  return (
    <Screen>
      {route.view !== "list" ? <TextAction label={copy("common.back")} accessibilityLabel={`${copy("common.back")}: ${copy("community.page.title")}`} onPress={() => setRoute({ view: "list" })} /> : null}
      {route.view === "list" ? <GroupListView onOpen={(slug) => setRoute({ view: "group", slug })} onOpenAppeals={() => setRoute({ view: "appeals" })} /> : null}
      {route.view === "group" ? (
        <GroupDetail
          slug={route.slug}
          onOpenAppeals={() => setRoute({ view: "appeals" })}
          onOpenEmergency={() => onNavigate("emergency")}
          onOpenMessages={() => onNavigate("messages")}
        />
      ) : null}
      {route.view === "appeals" ? <AppealsPage /> : null}
    </Screen>
  );
}

function GroupListView({ onOpen, onOpenAppeals }: { onOpen: (slug: string) => void; onOpenAppeals: () => void }) {
  const copy = useCopy();
  const [list, setList] = useState<GroupList | null | undefined>(undefined);
  const [groups, setGroups] = useState<readonly GroupSummary[]>([]);
  const [q, setQ] = useState("");
  const [searched, setSearched] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);

  const load = useCallback(async () => {
    const result = await loadGroupList().catch(() => null);
    setList(result);
    setGroups(result ? result.groups : []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function search() {
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await searchGroups(q).catch(() => null);
    setPending(false);
    if (result) {
      setGroups(result.groups);
      setSearched(isSearchQuery(q));
    } else {
      setError("community.feed.error");
    }
  }

  if (list === undefined) {
    return (
      <SkeletonGroup label={copy("community.feed.loading")}>
        <Skeleton height={28} />
        <Skeleton height={110} />
        <Skeleton height={110} />
      </SkeletonGroup>
    );
  }

  const gate = communityGate(list ?? undefined);
  if (gate !== "ready") {
    return <InlineAlert message={copy(gate === "adults_only" ? "community.adults_only" : "community.not_open")} tone="info" />;
  }

  return (
    <View style={{ gap: space.lg }}>
      <View style={{ gap: space.xs }}>
        <AppText variant="headline" heading>
          {copy("community.page.title")}
        </AppText>
        <AppText variant="body" tone="textMuted">
          {copy("community.page.subtitle")}
        </AppText>
      </View>

      <View accessibilityRole="search" style={{ gap: space.sm }}>
        <Field
          label={copy("community.groups.search_label")}
          value={q}
          onChangeText={setQ}
          maxLength={60}
          placeholder={copy("community.groups.search_placeholder")}
          returnKeyType="search"
          onSubmitEditing={() => void search()}
          autoCorrect={false}
        />
        <Button title={copy("community.groups.search_label")} onPress={() => void search()} variant="secondary" loading={pending} fullWidth={false} />
      </View>
      <Status text={error ? copy(error) : searched && groups.length === 0 ? copy("community.groups.search_empty") : null} />

      {groups.length === 0 ? (
        searched ? null : (
          <AppText variant="body" tone="textMuted">
            {copy("community.groups.empty")}
          </AppText>
        )
      ) : (
        groups.map((g) => <GroupCard key={g.id} group={g} onOpen={() => onOpen(g.slug)} />)
      )}

      <TextAction label={copy("community.appeals.link")} onPress={onOpenAppeals} />
    </View>
  );
}

function GroupCard({ group, onOpen }: { group: GroupSummary; onOpen: () => void }) {
  const copy = useCopy();
  const { colors } = useTheme();
  return (
    <Card>
      <View style={{ gap: space.sm }}>
        <AppText variant="label" tone="textMuted" style={{ textTransform: "uppercase" }}>
          {group.topic_label}
        </AppText>
        <AppText variant="title" heading style={{ color: colors.text }}>
          {group.name}
        </AppText>
        <AppText variant="body">{group.description}</AppText>
        <AppText variant="caption" tone="textMuted">
          {copy(memberCountKey(group.member_count), { count: group.member_count })}
          {group.my_status === "active" ? ` - ${copy("community.groups.you_are_in")}` : ""}
        </AppText>
        {group.full === true && group.my_status !== "active" ? <Badge label={copy("community.groups.full")} tone="neutral" /> : null}
        <Button title={copy("community.groups.open")} onPress={onOpen} variant="secondary" fullWidth={false} accessibilityHint={group.name} />
      </View>
    </Card>
  );
}

function AppealsPage() {
  const copy = useCopy();
  const [actions, setActions] = useState<MyActions | null | undefined>(undefined);

  const load = useCallback(async () => {
    setActions(await loadMyActions().catch(() => null));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={{ gap: space.lg }}>
      <View style={{ gap: space.xs }}>
        <AppText variant="headline" heading>
          {copy("community.appeals.title")}
        </AppText>
        {actions && actions.open ? (
          <AppText variant="body" tone="textMuted">
            {copy("community.appeals.intro")}
          </AppText>
        ) : null}
      </View>
      {actions === undefined ? (
        <SkeletonGroup label={copy("community.feed.loading")}>
          <Skeleton height={90} />
        </SkeletonGroup>
      ) : actions && actions.open ? (
        <AppealsView actions={actions} onChanged={() => void load()} />
      ) : (
        <InlineAlert message={copy("community.not_open")} tone="info" />
      )}
    </View>
  );
}
