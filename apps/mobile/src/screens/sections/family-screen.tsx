import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, ScrollView, Text, TextInput, View } from "react-native";
import {
  CARE_ACCESS_CATEGORIES,
  NEXT_OF_KIN_RELATIONSHIPS,
  cancelCareAccessRequest,
  inverseRelationship,
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
  type CareAccessRequestRow,
  type CareFollower,
  type EmergencyGrantOnMyRecord,
  type NextOfKinRelationship,
  type NextOfKinState,
} from "@/lib/family-consent";
import type { SectionId } from "@/lib/sections";
import { WebViewScreen } from "@/screens/webview-screen";
import { colors, radius, spacing } from "@/ui/theme";
import { CalloutCard, Card, ErrorText, MutedText, PrimaryButton, ScreenTitle, SecondaryButton } from "@/ui/components";

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

const textInputStyle = {
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radius.control,
  paddingHorizontal: 10,
  paddingVertical: 8,
  fontSize: 14,
  color: colors.ink,
} as const;

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
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
        color: active ? "#FFFFFF" : colors.ink,
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
 * next-of-kin card, emergency-access banner, the accept/decline request
 * flow, and per-category care visibility, per
 * docs/mobile-native-conversion/family.md's recommended first-pass scope
 * cut. `supporting-screen.tsx` already covers the opposite direction
 * (children/adults the caller looks after, grantee_user_id = me) — linked
 * from here rather than duplicated. The eldercare "manage" request wizard,
 * add-child/add-elder-proxy provisioning, the granular permission/expiry
 * sub-editor, the audit log, and the household rollup all stay WebView in
 * this pass (see the doc's own "Stay WebView" list) — reachable from the
 * "Manage children & dependants" card below.
 */
export function FamilyScreen({ userId, onNavigate }: FamilyScreenProps) {
  const [loading, setLoading] = useState(true);
  const [nextOfKin, setNextOfKin] = useState<NextOfKinState | null>(null);
  const [nextOfKinError, setNextOfKinError] = useState<string | null>(null);
  const [emergencyGrants, setEmergencyGrants] = useState<EmergencyGrantOnMyRecord[]>([]);
  const [requests, setRequests] = useState<CareAccessRequestRow[]>([]);
  const [followers, setFollowers] = useState<CareFollower[]>([]);
  const [followersError, setFollowersError] = useState(false);
  const [dependantsModalOpen, setDependantsModalOpen] = useState(false);

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
          records you keep. Everyone keeps their own account and their own subscription.
        </MutedText>
      </View>

      {emergencyGrants.length > 0 && (
        <Card style={{ borderColor: colors.status.warn, backgroundColor: colors.status.warnBg, gap: 8 }}>
          <Text style={{ fontSize: 13.5, fontWeight: "700", color: colors.ink }}>Emergency access is active on your record</Text>
          {emergencyGrants.map((g) => (
            <EmergencyGrantRow key={g.id} grant={g} userId={userId} onChanged={refresh} />
          ))}
        </Card>
      )}

      <CareAccessRequestsCard requests={requests} currentUserId={userId} onChanged={refresh} />

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

      <CalloutCard
        icon="people-circle-outline"
        title="Manage children & dependants"
        subtitle="Keep a child's record, set up eldercare access, and review your access history in the full patient app."
        ctaLabel="Open dependants & eldercare"
        onPress={() => setDependantsModalOpen(true)}
      />
      <Modal visible={dependantsModalOpen} animationType="slide" onRequestClose={() => setDependantsModalOpen(false)}>
        <View style={{ flex: 1 }}>
          <View style={{ padding: spacing.screen, paddingTop: 56 }}>
            <SecondaryButton title="Close" onPress={() => setDependantsModalOpen(false)} />
          </View>
          <WebViewScreen path="/patient/family" />
        </View>
      </Modal>
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
      <Text style={{ fontSize: 13, color: colors.ink, flex: 1 }}>
        <Text style={{ fontWeight: "700" }}>{grant.granteeName ?? "Someone you gave care access to"}</Text> can see your health
        information until {shortDateTime(grant.expiresAt)}. Reason given: {grant.reason}
      </Text>
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
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Requests</Text>
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
            <Text style={{ fontSize: 13, color: colors.ink }}>{text}</Text>
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
            <Text style={{ fontSize: 13, color: colors.muted }}>{text}</Text>
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
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Your next of kin</Text>
      <MutedText>
        One person we contact if something urgent comes up. If they have a Tarragon account of their own,
        we&apos;ll ask them to confirm before they can also follow your care: see your readings,
        appointments and results. They can never change anything on your record, and either of you can
        withdraw access at any time.
      </MutedText>

      {error && <ErrorText>{error}</ErrorText>}
      {message && <MutedText>{message}</MutedText>}

      {current.name && (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{current.name}</Text>
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
          <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>Their name</Text>
          <TextInput value={fullName} onChangeText={setFullName} style={textInputStyle} />
        </View>
      </View>
      <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>Relationship to you</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {NEXT_OF_KIN_RELATIONSHIPS.map((r) => (
          <Chip key={r} label={RELATIONSHIP_LABEL[r]} active={relationship === r} onPress={() => setRelationship(r)} />
        ))}
      </View>
      <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>Their phone number</Text>
      <TextInput value={phone} onChangeText={setPhone} placeholder="+2348012345678" keyboardType="phone-pad" style={textInputStyle} />
      <MutedText>If this number belongs to a Tarragon account, they&apos;ll be able to follow your care straight away.</MutedText>

      <PrimaryButton title={current.name ? "Update next of kin" : "Save next of kin"} onPress={submit} loading={submitting} />
    </Card>
  );
}

function CareVisibilityCard({ followers, onChanged }: { followers: CareFollower[]; onChanged: () => void }) {
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
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Who can see your health information</Text>
      <MutedText>
        These people can already be contacted about you. Seeing any part of your record is a separate yes,
        category by category, and it is yours to give or take back at any time. Tap a name to change it.
      </MutedText>
      {error && <ErrorText>{error}</ErrorText>}

      {followers.map((follower) => {
        const name = follower.fullName ?? "Someone you have added";
        const open = openId === follower.grantId;
        const reproductiveHealthOn = follower.categories.includes("reproductive_health");
        return (
          <View key={follower.grantId} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, gap: 8 }}>
            <Text onPress={() => setOpenId(open ? null : follower.grantId)} style={{ fontSize: 13, color: colors.ink }}>
              <Text style={{ fontWeight: "700" }}>{name}</Text>
              {"  "}
              <Text style={{ fontSize: 11, color: colors.muted }}>
                {follower.permissionLevel === "manage" ? "Can act for you" : "Next of kin"} ·{" "}
                {follower.categories.length === 0 ? "Cannot see your health information" : `Can see ${follower.categories.length} of 8`} ·{" "}
                {expiryLabel(follower.expiresAt)}
              </Text>
            </Text>

            {open && (
              <View style={{ backgroundColor: colors.groupBg, borderRadius: radius.control, padding: 10, gap: 8 }}>
                <MutedText>
                  Tick what {name} should be able to see. They will never be able to change anything on your
                  record, or end a conversation you are having. You will see every message they send.
                </MutedText>
                {CARE_ACCESS_CATEGORIES.map((cat) => (
                  <Text
                    key={cat.value}
                    onPress={() => (saving ? null : setAll(follower.grantId, toggled(follower.categories, cat.value)))}
                    style={{ fontSize: 13, color: colors.ink, paddingVertical: 3 }}
                  >
                    <Text style={{ fontWeight: "700", color: follower.categories.includes(cat.value) ? colors.brand : colors.faint }}>
                      {follower.categories.includes(cat.value) ? "☑ " : "☐ "}
                    </Text>
                    {cat.label}
                  </Text>
                ))}
                <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, backgroundColor: colors.card, padding: 10, gap: 4 }}>
                  <Text
                    onPress={() => (saving ? null : setAll(follower.grantId, toggled(follower.categories, "reproductive_health")))}
                    style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}
                  >
                    <Text style={{ fontWeight: "700", color: reproductiveHealthOn ? colors.brand : colors.faint }}>
                      {reproductiveHealthOn ? "☑ " : "☐ "}
                    </Text>
                    Reproductive health
                  </Text>
                  <MutedText>
                    Kept separate on purpose: turning on everything else above never includes this. Cycle,
                    pregnancy and related information stays private unless you choose to share it here too.
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
