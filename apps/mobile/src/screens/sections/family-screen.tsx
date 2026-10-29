import { ProxyReviewCard } from "@/screens/sections/proxy-review-card";
import { ProxyArrangementsCard, ProxySetupCard } from "@/screens/sections/proxy-section";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import {
  CARE_ACCESS_CATEGORIES,
  NEXT_OF_KIN_RELATIONSHIPS,
  cancelCareAccessRequest,
  describeCareAccessEvent,
  inverseRelationship,
  loadCareAccessLog,
  loadCareAccessRequests,
  loadEmergencyGrantsOnMyRecord,
  loadMyCareFollowers,
  loadNextOfKin,
  nominateNextOfKin,
  respondToCareAccessRequest,
  revokeCareAccess,
  revokeEmergencyAccess,
  setCareAccessCategories,
  type CareAccessCategory,
  type CareAccessLogRow,
  type CareAccessRequestRow,
  type CareFollower,
  type EmergencyGrantOnMyRecord,
  type NextOfKinRelationship,
  type NextOfKinState,
} from "@/lib/family-consent";
import * as WebBrowser from "expo-web-browser";
import type { SectionId } from "@/lib/sections";
import { CareCircleSection } from "./care-circle-section";
import { CohortsSection } from "./cohorts-section";
import { ProxySetupSection } from "./proxy-setup-section";
import { PLATFORM_URL } from "@/lib/platform-url";
import { radius, spacing } from "@/ui/theme";
import { useLegacyColors, useTextInputStyle, useTheme, placeholderColorFor } from "@/ui/design";
import { CalloutCard, Card, ErrorText, MutedText, PrimaryButton, ScreenTitle, SecondaryButton } from "@/ui/legacy-kit";
import { AppText } from "@/ui/kit/AppText";

function shortDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

function expiryLabel(expiresAt: string | null): string {
  if (!expiresAt) return "Permanent";
  const days = daysUntil(expiresAt);
  if (days < 0) return "Expired";
  if (days === 0) return "Expires today";
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const colors = useLegacyColors();
  return (
    <Text
      onPress={onPress}
      style={{
        fontSize: 12.5,
        fontWeight: "600",
        paddingVertical: 7,
        paddingHorizontal: 11,
        borderRadius: 999,
        backgroundColor: active ? colors.brand : colors.groupBg,
        color: active ? colors.onBrand : colors.ink,
      }}
    >
      {label}
    </Text>
  );
}

interface FamilyScreenProps {
  userId: string;
  onNavigate: (section: SectionId) => void;
}

const LEVEL_LABEL: Record<"view" | "manage", string> = { view: "view", manage: "manage" };

/**
 * "Your people" — Family's `profile_id = me` direction: who can see/act on
 * the caller's OWN record. Mirrors apps/web/.../patient/family/page.tsx's
 * next-of-kin card, emergency-access banner, accept/decline request flow,
 * per-category care visibility, and access-history log — all native.
 * `supporting-screen.tsx` already covers the opposite direction (children/
 * adults the caller looks after, grantee_user_id = me) — linked from here
 * rather than duplicated. Only the eldercare "manage" request wizard and
 * add-child/add-elder-proxy provisioning stay a system-browser hand-off
 * (never an embedded WebView, which this app no longer has at all) — see
 * the "Manage children & dependants" card below for why: that flow runs on
 * a service-role client that must never ship in the mobile bundle.
 */
export function FamilyScreen({ userId, onNavigate }: FamilyScreenProps) {
  const colors = useLegacyColors();
  const [loading, setLoading] = useState(true);
  const [nextOfKin, setNextOfKin] = useState<NextOfKinState | null>(null);
  const [nextOfKinError, setNextOfKinError] = useState<string | null>(null);
  const [emergencyGrants, setEmergencyGrants] = useState<EmergencyGrantOnMyRecord[]>([]);
  const [requests, setRequests] = useState<CareAccessRequestRow[]>([]);
  const [followers, setFollowers] = useState<CareFollower[]>([]);
  const [followersError, setFollowersError] = useState(false);
  const [activityLog, setActivityLog] = useState<CareAccessLogRow[]>([]);
  const [activityLogError, setActivityLogError] = useState(false);

  const refresh = useCallback(async () => {
    const [nokResult, grants, reqs] = await Promise.all([
      loadNextOfKin(userId),
      loadEmergencyGrantsOnMyRecord(userId),
      loadCareAccessRequests(userId),
    ]);
    if (nokResult.ok) {
      setNextOfKin(nokResult.data);
      setNextOfKinError(null);
    } else {
      setNextOfKinError(nokResult.error);
    }
    setEmergencyGrants(grants);
    setRequests(reqs);
    try {
      setFollowers(await loadMyCareFollowers(userId));
      setFollowersError(false);
    } catch {
      setFollowersError(true);
    }
    try {
      setActivityLog(await loadCareAccessLog(userId));
      setActivityLogError(false);
    } catch {
      setActivityLogError(true);
    }
  }, [userId]);

  useEffect(() => {
    refresh()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refresh]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 16 }}>
      <View>
        <ScreenTitle>Your people</ScreenTitle>
        <MutedText>
          Who we contact if something urgent comes up, who can follow your care, and the children whose
          records you keep. Everyone keeps their own account, rather than a shared or family plan.
        </MutedText>
      </View>

      <CareCircleSection />

      <CohortsSection />

      {emergencyGrants.length > 0 && (
        <Card style={{ borderColor: colors.status.warn, backgroundColor: colors.status.warnBg, gap: 8 }}>
          <AppText variant="bodyStrong">Emergency access is active on your record</AppText>
          {emergencyGrants.map((g) => (
            <EmergencyGrantRow key={g.id} grant={g} userId={userId} onChanged={refresh} />
          ))}
        </Card>
      )}

      <CareAccessRequestsCard requests={requests} currentUserId={userId} onChanged={refresh} />

      <ProxySetupSection />

      <CalloutCard
        icon="people-outline"
        title="People you support"
        subtitle="Children and adults whose care you manage — open, switch accounts, and act on their behalf."
        ctaLabel="Open people you support"
        onPress={() => onNavigate("supporting")}
      />

      {nextOfKinError ? (
        <Card>
          <ErrorText>Couldn&apos;t load your next of kin just now. Please refresh and try again.</ErrorText>
        </Card>
      ) : (
        nextOfKin && <NextOfKinCard current={nextOfKin} userId={userId} onChanged={refresh} />
      )}

      {followersError ? (
        <Card>
          <ErrorText>
            We couldn&apos;t load who can see your health information just now. Nobody has gained or lost
            access because of this — refresh to try again.
          </ErrorText>
        </Card>
      ) : (
        followers.length > 0 && <CareVisibilityCard followers={followers} onChanged={refresh} />
      )}

      {activityLogError ? (
        <Card>
          <ErrorText>We couldn&apos;t load your access history just now. Refresh to try again.</ErrorText>
        </Card>
      ) : (
        activityLog.length > 0 && <CareAccessLogCard events={activityLog} />
      )}

      <ProxyReviewCard />
      <ProxyArrangementsCard />

      <ProxySetupCard />

      <CalloutCard
        icon="people-circle-outline"
        title="Manage children & dependants"
        // Adding a child/elder-proxy account runs on a service-role client
        // (auth.admin.createUser/updateUserById) — that credential must
        // never ship in the mobile bundle, so this stays a system-browser
        // hand-off (never an embedded WebView) rather than a native rebuild,
        // same reasoning as Subscription/payment elsewhere in this app.
        subtitle="Keep a child's record and set up eldercare access on the web."
        ctaLabel="Open dependants & eldercare"
        onPress={() => void WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/family`)}
      />
    </ScrollView>
  );
}

function EmergencyGrantRow({ grant, userId, onChanged }: { grant: EmergencyGrantOnMyRecord; userId: string; onChanged: () => void }) {
  const [revoking, setRevoking] = useState(false);

  async function revoke() {
    setRevoking(true);
    await revokeEmergencyAccess(grant.id, userId);
    setRevoking(false);
    onChanged();
  }

  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <AppText variant="body" style={{ flex: 1 }}>
        <AppText variant="bodyStrong">{grant.granteeName ?? "Someone you gave care access to"}</AppText> can see your health
        information until {shortDateTime(grant.expiresAt)}. Reason given: {grant.reason}
      </AppText>
      <SecondaryButton title={revoking ? "Ending…" : "End it now"} onPress={revoke} loading={revoking} />
    </View>
  );
}

function CareAccessRequestsCard({
  requests,
  currentUserId,
  onChanged,
}: {
  requests: CareAccessRequestRow[];
  currentUserId: string;
  onChanged: () => void;
}) {
  const colors = useLegacyColors();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (requests.length === 0) return null;

  const needsMyResponse = requests.filter((r) => r.initiated_by !== currentUserId);
  const waitingOnThem = requests.filter((r) => r.initiated_by === currentUserId);

  async function respond(id: string, accept: boolean) {
    setError(null);
    setPendingId(id);
    const result = await respondToCareAccessRequest(id, accept);
    setPendingId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onChanged();
  }

  async function cancel(id: string) {
    setError(null);
    setPendingId(id);
    const result = await cancelCareAccessRequest(id, currentUserId);
    setPendingId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onChanged();
  }

  return (
    <Card style={{ gap: 10 }}>
      <AppText variant="bodyStrong">Requests</AppText>
      <MutedText>Nothing here changes what anyone can see or do until both sides agree.</MutedText>
      {error && <ErrorText>{error}</ErrorText>}

      {needsMyResponse.map((r) => {
        const isAboutMyRecord = r.profile_id === currentUserId;
        const otherName = (isAboutMyRecord ? r.counterparty_name : r.owner_name) ?? "Someone";
        const displayedRelationship = r.relationship ? (isAboutMyRecord ? r.relationship : inverseRelationship(r.relationship)) : null;
        const text = isAboutMyRecord
          ? `${otherName} has asked to ${LEVEL_LABEL[r.permission_level]} your care${displayedRelationship ? ` (your ${displayedRelationship})` : ""}.`
          : `${otherName} wants you to be able to ${LEVEL_LABEL[r.permission_level]} their care${displayedRelationship ? ` (your ${displayedRelationship})` : ""}.`;
        return (
          <View key={r.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 10, gap: 8 }}>
            <AppText variant="body">{text}</AppText>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <PrimaryButton title="Accept" onPress={() => respond(r.id, true)} loading={pendingId === r.id} />
              <SecondaryButton title="Decline" onPress={() => respond(r.id, false)} disabled={pendingId === r.id} />
            </View>
          </View>
        );
      })}

      {waitingOnThem.map((r) => {
        const isAboutMyRecord = r.profile_id === currentUserId;
        const otherName = (isAboutMyRecord ? r.counterparty_name : r.owner_name) ?? "them";
        const text = isAboutMyRecord
          ? `You offered ${otherName} the ability to ${LEVEL_LABEL[r.permission_level]} your care: waiting for them to accept.`
          : `You asked to ${LEVEL_LABEL[r.permission_level]} ${otherName}'s care: waiting for them to accept.`;
        return (
          <View key={r.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 10, gap: 8, backgroundColor: colors.groupBg }}>
            <AppText variant="body" tone="textMuted">{text}</AppText>
            <SecondaryButton title="Withdraw" onPress={() => cancel(r.id)} loading={pendingId === r.id} />
          </View>
        );
      })}
    </Card>
  );
}

const RELATIONSHIP_LABEL: Record<string, string> = {
  spouse: "Spouse",
  child: "Child",
  parent: "Parent",
  sibling: "Sibling",
  other: "Other",
};

function NextOfKinCard({ current, userId, onChanged }: { current: NextOfKinState; userId: string; onChanged: () => void }) {
  const colors = useLegacyColors();
  const textInputStyle = useTextInputStyle();
  const { scheme } = useTheme();
  const [fullName, setFullName] = useState(current.name ?? "");
  const [phone, setPhone] = useState(current.phone ?? "");
  const [relationship, setRelationship] = useState<NextOfKinRelationship>((current.relationship as NextOfKinRelationship) ?? "child");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setMessage(null);
    setSubmitting(true);
    const result = await nominateNextOfKin(userId, { full_name: fullName, phone, relationship });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage(result.data);
    onChanged();
  }

  async function revoke() {
    if (!current.grantId) return;
    setSubmitting(true);
    const result = await revokeCareAccess(current.grantId, userId);
    setSubmitting(false);
    if (result.ok) {
      setMessage("Access withdrawn.");
      onChanged();
    }
  }

  async function cancelRequest() {
    if (!current.pendingRequestId) return;
    setSubmitting(true);
    const result = await cancelCareAccessRequest(current.pendingRequestId, userId);
    setSubmitting(false);
    if (result.ok) {
      setMessage("Request withdrawn.");
      onChanged();
    }
  }

  return (
    <Card style={{ gap: 10 }}>
      <AppText variant="bodyStrong">Your next of kin</AppText>
      <MutedText>
        One person we contact if something urgent comes up. If they have a Tarragon account of their own,
        we&apos;ll ask them to confirm before they can also follow your care: see your readings,
        appointments and results. They cannot change anything on your record, and either of you can
        withdraw access at any time.
      </MutedText>

      {error && <ErrorText>{error}</ErrorText>}
      {message && <MutedText>{message}</MutedText>}

      {current.name && (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 10 }}>
          <View style={{ flex: 1 }}>
            <AppText variant="label">{current.name}</AppText>
            <MutedText>
              {RELATIONSHIP_LABEL[current.relationship ?? "other"] ?? current.relationship} · {current.phone}
              {current.grantId ? " · can view your care" : current.pendingRequestId ? " · waiting for them to accept" : " · contact only, no Tarragon account on this number"}
            </MutedText>
          </View>
          {current.grantId && <SecondaryButton title="Withdraw access" onPress={revoke} loading={submitting} />}
          {current.pendingRequestId && <SecondaryButton title="Withdraw request" onPress={cancelRequest} loading={submitting} />}
        </View>
      )}

      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <AppText variant="label">Their name</AppText>
          <TextInput keyboardAppearance={scheme} placeholderTextColor={placeholderColorFor(scheme)} value={fullName} onChangeText={setFullName} style={textInputStyle} />
        </View>
      </View>
      <AppText variant="label">Relationship to you</AppText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {NEXT_OF_KIN_RELATIONSHIPS.map((r) => (
          <Chip key={r} label={RELATIONSHIP_LABEL[r]} active={relationship === r} onPress={() => setRelationship(r)} />
        ))}
      </View>
      <AppText variant="label">Their phone number</AppText>
      <TextInput keyboardAppearance={scheme} placeholderTextColor={placeholderColorFor(scheme)} value={phone} onChangeText={setPhone} placeholder="+2348012345678" keyboardType="phone-pad" style={textInputStyle} />
      <MutedText>If this number belongs to a Tarragon account, they&apos;ll be able to follow your care straight away.</MutedText>

      <PrimaryButton title={current.name ? "Update next of kin" : "Save next of kin"} onPress={submit} loading={submitting} />
    </Card>
  );
}

function CareVisibilityCard({ followers, onChanged }: { followers: CareFollower[]; onChanged: () => void }) {
  const colors = useLegacyColors();
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function setAll(grantId: string, categories: CareAccessCategory[]) {
    setError(null);
    setSaving(true);
    const result = await setCareAccessCategories(grantId, categories);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onChanged();
  }

  function toggled(categories: CareAccessCategory[], category: CareAccessCategory): CareAccessCategory[] {
    return categories.includes(category) ? categories.filter((c) => c !== category) : [...categories, category];
  }

  return (
    <Card style={{ gap: 10 }}>
      <AppText variant="bodyStrong">Who can see your health information</AppText>
      <MutedText>
        These people can already be contacted about you. Seeing any part of your record is a separate yes,
        category by category, and it is yours to give or take back at any time. Tap a name to change it.
      </MutedText>
      {error && <ErrorText>{error}</ErrorText>}

      {followers.map((follower) => {
        const name = follower.fullName ?? "Someone you have added";
        const open = openId === follower.grantId;
        const reproductiveHealthOn = follower.categories.includes("reproductive_health");
        const mentalHealthOn = follower.categories.includes("mental_health");
        return (
          <View key={follower.grantId} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, gap: 8 }}>
            <AppText variant="body" onPress={() => setOpenId(open ? null : follower.grantId)}>
              <AppText variant="bodyStrong">{name}</AppText>
              {"  "}
              <AppText variant="caption" tone="textMuted">
                {follower.permissionLevel === "manage" ? "Can act for you" : "Next of kin"} ·{" "}
                {follower.categories.length === 0 ? "Cannot see your health information" : `Can see ${follower.categories.length} of 8`} ·{" "}
                {expiryLabel(follower.expiresAt)}
              </AppText>
            </AppText>

            {open && (
              <View style={{ backgroundColor: colors.groupBg, borderRadius: radius.control, padding: 10, gap: 8 }}>
                <MutedText>
                  Tick what {name} should be able to see. They will not be able to change anything on your
                  record, or end a conversation you are having. You will see every message they send.
                </MutedText>
                {CARE_ACCESS_CATEGORIES.map((cat) => (
                  <AppText variant="body" key={cat.value} onPress={() => (saving ? null : setAll(follower.grantId, toggled(follower.categories, cat.value)))} style={{ paddingVertical: 3 }}>
                    <Text style={{ fontWeight: "700", color: follower.categories.includes(cat.value) ? colors.brandPressed : colors.faint }}>
                      {follower.categories.includes(cat.value) ? "☑ " : "☐ "}
                    </Text>
                    {cat.label}
                  </AppText>
                ))}
                <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, backgroundColor: colors.card, padding: 10, gap: 4 }}>
                  <AppText variant="label" onPress={() => (saving ? null : setAll(follower.grantId, toggled(follower.categories, "reproductive_health")))}>
                    <Text style={{ fontWeight: "700", color: reproductiveHealthOn ? colors.brandPressed : colors.faint }}>
                      {reproductiveHealthOn ? "☑ " : "☐ "}
                    </Text>
                    Reproductive health
                  </AppText>
                  <MutedText>
                    Kept separate on purpose: turning on everything else above leaves this untouched. Cycle,
                    pregnancy and related information stays private unless you choose to share it here too.
                  </MutedText>
                </View>
                <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, backgroundColor: colors.card, padding: 10, gap: 4 }}>
                  <AppText variant="label" onPress={() => (saving ? null : setAll(follower.grantId, toggled(follower.categories, "mental_health")))}>
                    <Text style={{ fontWeight: "700", color: mentalHealthOn ? colors.brandPressed : colors.faint }}>
                      {mentalHealthOn ? "☑ " : "☐ "}
                    </Text>
                    Mental wellbeing
                  </AppText>
                  <MutedText>
                    Kept separate on purpose: turning on everything else above leaves this untouched. Your check-ins,
                    questionnaire answers and any therapy bookings stay private unless you choose to share them here.
                    You can turn this off at any time.
                  </MutedText>
                </View>
                <MutedText>Added {shortDate(follower.since)}.</MutedText>
              </View>
            )}
          </View>
        );
      })}
    </Card>
  );
}

const ACCESS_LOG_PAGE_SIZE = 5;

/** "What's happened with your access" — every time someone's access to a
 * record changed, on the caller's own record or one they help look after.
 * Mirrors care-access-log.tsx's describe() via describeCareAccessEvent, so
 * the same event reads as the same sentence on both platforms. Read-only,
 * capped at the same 30 rows web shows, paginated 5 at a time so a long
 * history doesn't dump the whole card onto the screen at once. */
function CareAccessLogCard({ events }: { events: CareAccessLogRow[] }) {
  const colors = useLegacyColors();
  const [visibleCount, setVisibleCount] = useState(ACCESS_LOG_PAGE_SIZE);
  const visible = events.slice(0, visibleCount);
  const hasMore = visibleCount < events.length;

  return (
    <Card style={{ gap: 8 }}>
      <AppText variant="bodyStrong">What&apos;s happened with your access</AppText>
      <MutedText>
        Every time someone&apos;s access to a record changed, on your record or one you help look after.
      </MutedText>
      {visible.map((row) => (
        <View
          key={row.id}
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}
        >
          <AppText variant="body" style={{ flex: 1 }}>{describeCareAccessEvent(row)}</AppText>
          <AppText variant="caption" tone="textSubtle" style={{ flexShrink: 0 }}>{shortDate(row.occurredAt)}</AppText>
        </View>
      ))}
      {hasMore && (
        <SecondaryButton title="Show more" onPress={() => setVisibleCount((count) => count + ACCESS_LOG_PAGE_SIZE)} />
      )}
    </Card>
  );
}
