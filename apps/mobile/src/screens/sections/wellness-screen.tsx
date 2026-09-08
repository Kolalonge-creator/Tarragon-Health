import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import { koboToNaira } from "@tarragon/shared";
import {
  enrolInWellnessChallenge,
  loadMyChallengeEnrolments,
  loadMyClassRegistrations,
  loadMyWellnessBadges,
  loadUpcomingWellnessClasses,
  loadWellnessBadgesCatalogue,
  loadWellnessChallengeProgress,
  loadWellnessChallengesCatalogue,
  loadWellnessPointsBalance,
  loadWellnessPointsLedger,
  markWellnessClassAttended,
  reasonLabel,
  redeemWellnessPoints,
  registerForWellnessClass,
  type ChallengeEnrolment,
  type PatientWellnessBadge,
  type WellnessBadge,
  type WellnessChallenge,
  type WellnessClass,
  type WellnessClassRegistration,
  type WellnessPointsBalance,
  type WellnessPointsLedgerEntry,
} from "@/lib/wellness";
import type { SectionId } from "@/lib/sections";
import { colors, radius, spacing } from "@/ui/theme";
import { Card, ErrorText, MutedText, ScreenTitle, SecondaryButton } from "@/ui/components";

function classDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const TONE_COLOR = {
  brand: { bg: colors.brandTint, text: colors.brandPressed },
  neutral: { bg: colors.groupBg, text: colors.muted },
} as const;

function StatusBadge({ text, tone }: { text: string; tone: keyof typeof TONE_COLOR }) {
  const c = TONE_COLOR[tone];
  return (
    <View style={{ backgroundColor: c.bg, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 }}>
      <Text style={{ fontSize: 11, fontWeight: "600", color: c.text }}>{text}</Text>
    </View>
  );
}

interface WellnessScreenProps {
  patientId: string;
  organisationId: string;
  onNavigate: (section: SectionId) => void;
}

/**
 * "Wellness rewards" — points/ledger/redeem, badges, challenges, and
 * workout classes, mirroring apps/web/.../patient/wellness/page.tsx's
 * in-scope half (the embedded Meal Log / NutritionFlow is a structurally
 * distinct AI feature, deliberately not ported here — see
 * docs/mobile-native-conversion/wellness.md). No new API routes — every
 * mutation is a plain RLS-scoped call or a SECURITY DEFINER RPC already
 * granted to authenticated.
 */
export function WellnessScreen({ patientId, organisationId, onNavigate }: WellnessScreenProps) {
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState<WellnessPointsBalance | null>(null);
  const [ledger, setLedger] = useState<WellnessPointsLedgerEntry[]>([]);
  const [badgeCatalogue, setBadgeCatalogue] = useState<WellnessBadge[]>([]);
  const [myBadges, setMyBadges] = useState<PatientWellnessBadge[]>([]);
  const [challengeCatalogue, setChallengeCatalogue] = useState<WellnessChallenge[]>([]);
  const [enrolments, setEnrolments] = useState<ChallengeEnrolment[]>([]);
  const [classes, setClasses] = useState<WellnessClass[]>([]);
  const [registrations, setRegistrations] = useState<WellnessClassRegistration[]>([]);

  const refresh = useCallback(async () => {
    const [b, l, bc, mb, cc, en, cl, reg] = await Promise.all([
      loadWellnessPointsBalance(patientId),
      loadWellnessPointsLedger(patientId, 8),
      loadWellnessBadgesCatalogue(),
      loadMyWellnessBadges(patientId),
      loadWellnessChallengesCatalogue(),
      loadMyChallengeEnrolments(patientId),
      loadUpcomingWellnessClasses(),
      loadMyClassRegistrations(patientId),
    ]);
    setBalance(b);
    setLedger(l);
    setBadgeCatalogue(bc);
    setMyBadges(mb);
    setChallengeCatalogue(cc);
    setEnrolments(en);
    setClasses(cl);
    setRegistrations(reg);
  }, [patientId]);

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
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.screen, gap: 16 }}
    >
      <View>
        <ScreenTitle>Wellness rewards</ScreenTitle>
        <MutedText>
          Small, everyday habits add up. Earn points for logging, learning, and finishing challenges,
          collect badges along the way, and redeem points any time for a real reward voucher you can put
          toward your care.
        </MutedText>
      </View>

      <PointsCard balance={balance} ledger={ledger} onChanged={refresh} onNavigate={onNavigate} />
      <BadgesCard catalogue={badgeCatalogue} earned={myBadges} />
      <ChallengesCard catalogue={challengeCatalogue} enrolments={enrolments} onChanged={refresh} />
      <ClassesCard
        classes={classes}
        registrations={registrations}
        patientId={patientId}
        organisationId={organisationId}
        onChanged={refresh}
      />
    </ScrollView>
  );
}

function PointsCard({
  balance,
  ledger,
  onChanged,
  onNavigate,
}: {
  balance: WellnessPointsBalance | null;
  ledger: WellnessPointsLedgerEntry[];
  onChanged: () => void;
  onNavigate: (section: SectionId) => void;
}) {
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [redeemed, setRedeemed] = useState(false);

  const currentBalance = balance?.balance ?? 0;

  async function submit() {
    setError(null);
    setMessage(null);
    const points = Number(amount);
    if (!points || points <= 0) {
      setError("Enter a positive number of points.");
      return;
    }
    setSubmitting(true);
    const result = await redeemWellnessPoints(points);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage(`Redeemed: a ₦${koboToNaira(result.data.koboCredited ?? 0).toLocaleString()} reward voucher is now on your account.`);
    setAmount("");
    setRedeemed(true);
    onChanged();
  }

  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Wellness points</Text>
      <MutedText>
        Earn points for logging vitals, meals, and check-ins, finishing lessons, and hitting challenges.
        Redeem any time for a reward voucher you can put toward your care.
      </MutedText>

      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
        <Text style={{ fontSize: 28, fontWeight: "700", color: colors.ink }}>{currentBalance.toLocaleString()}</Text>
        <MutedText>
          points{balance?.lifetime_earned ? ` · ${balance.lifetime_earned.toLocaleString()} earned all-time` : ""}
        </MutedText>
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>Redeem for a voucher</Text>
        <TextInput
          value={amount}
          onChangeText={setAmount}
          placeholder="e.g. 100"
          keyboardType="numeric"
          style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: colors.ink }}
        />
        {error && <ErrorText>{error}</ErrorText>}
        {message && <MutedText>{message}</MutedText>}
        <SecondaryButton title="Redeem" onPress={submit} disabled={currentBalance <= 0} loading={submitting} />
        {redeemed && (
          <Text onPress={() => onNavigate("financialProfile")} style={{ fontSize: 13, fontWeight: "600", color: colors.brand }}>
            See your voucher in Your finances →
          </Text>
        )}
      </View>

      {ledger.length > 0 && (
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.3, color: colors.muted }}>
            Recent activity
          </Text>
          {ledger.map((entry) => (
            <View key={entry.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 }}>
              <Text style={{ fontSize: 13, color: colors.ink }}>{reasonLabel(entry.reason)}</Text>
              <Text style={{ fontSize: 13, fontWeight: "600", color: entry.points > 0 ? colors.brand : colors.muted }}>
                {entry.points > 0 ? "+" : ""}
                {entry.points}
              </Text>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

function BadgesCard({ catalogue, earned }: { catalogue: WellnessBadge[]; earned: PatientWellnessBadge[] }) {
  const earnedIds = new Set(earned.map((b) => b.badge_id));

  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Badges</Text>
      <MutedText>
        {earned.length} of {catalogue.length} earned.
      </MutedText>
      {catalogue.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {catalogue.map((badge) => {
            const isEarned = earnedIds.has(badge.id);
            return (
              <View
                key={badge.id}
                style={{
                  flexBasis: "31%",
                  flexGrow: 1,
                  alignItems: "center",
                  gap: 4,
                  borderRadius: radius.control,
                  borderWidth: 1,
                  borderColor: isEarned ? colors.brand : colors.border,
                  backgroundColor: isEarned ? colors.brandTint : colors.groupBg,
                  padding: 10,
                  opacity: isEarned ? 1 : 0.6,
                }}
              >
                <Text style={{ fontSize: 20 }}>🏅</Text>
                <Text style={{ fontSize: 11.5, fontWeight: "600", color: colors.ink, textAlign: "center" }}>{badge.name}</Text>
                <Text style={{ fontSize: 10.5, color: colors.muted, textAlign: "center" }}>{badge.description}</Text>
              </View>
            );
          })}
        </View>
      )}
    </Card>
  );
}

function ProgressBar({ value, target }: { value: number; target: number }) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  return (
    <View style={{ height: 8, width: "100%", borderRadius: 999, backgroundColor: colors.groupBg, overflow: "hidden" }}>
      <View style={{ height: "100%", width: `${pct}%`, borderRadius: 999, backgroundColor: colors.brand }} />
    </View>
  );
}

function ActiveEnrolmentRow({ enrolment }: { enrolment: ChallengeEnrolment }) {
  const [progress, setProgress] = useState<{ progress: number; target: number } | null>(null);
  const challenge = enrolment.wellness_challenges;

  useEffect(() => {
    if (enrolment.status !== "active") return;
    loadWellnessChallengeProgress(enrolment.id)
      .then(setProgress)
      .catch(() => {});
  }, [enrolment.id, enrolment.status]);

  if (!challenge) return null;

  return (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 10, gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{challenge.title}</Text>
        <StatusBadge text={enrolment.status} tone={enrolment.status === "completed" ? "brand" : "neutral"} />
      </View>
      {enrolment.status === "active" && progress && (
        <View style={{ gap: 4 }}>
          <ProgressBar value={progress.progress} target={progress.target} />
          <MutedText>
            {progress.progress} of {progress.target}
          </MutedText>
        </View>
      )}
    </View>
  );
}

function ChallengesCard({
  catalogue,
  enrolments,
  onChanged,
}: {
  catalogue: WellnessChallenge[];
  enrolments: ChallengeEnrolment[];
  onChanged: () => void;
}) {
  const [joining, setJoining] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeChallengeIds = new Set(enrolments.filter((e) => e.status === "active").map((e) => e.challenge_id));
  const available = catalogue.filter((c) => !activeChallengeIds.has(c.id));
  const shown = enrolments.filter((e) => e.status !== "expired");

  async function join(challengeId: string) {
    setError(null);
    setJoining(challengeId);
    const result = await enrolInWellnessChallenge(challengeId);
    setJoining(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onChanged();
  }

  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Challenges</Text>
      <MutedText>Time-boxed goals that pay a points bonus when you finish.</MutedText>

      {shown.length > 0 && (
        <View style={{ gap: 8 }}>
          {shown.map((e) => (
            <ActiveEnrolmentRow key={e.id} enrolment={e} />
          ))}
        </View>
      )}

      {available.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.3, color: colors.muted }}>
            Available
          </Text>
          {available.map((challenge) => (
            <View
              key={challenge.id}
              style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 10 }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{challenge.title}</Text>
                <MutedText>
                  {challenge.description} · {challenge.points_reward} pts
                </MutedText>
              </View>
              <Text
                onPress={() => (joining ? null : join(challenge.id))}
                style={{ fontSize: 12.5, fontWeight: "700", color: colors.brand, opacity: joining === challenge.id ? 0.5 : 1 }}
              >
                Join
              </Text>
            </View>
          ))}
        </View>
      )}

      {error && <ErrorText>{error}</ErrorText>}
    </Card>
  );
}

function ClassesCard({
  classes,
  registrations,
  patientId,
  organisationId,
  onChanged,
}: {
  classes: WellnessClass[];
  registrations: WellnessClassRegistration[];
  patientId: string;
  organisationId: string;
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function register(classId: string) {
    setError(null);
    setBusyId(classId);
    const result = await registerForWellnessClass(patientId, organisationId, classId);
    setBusyId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onChanged();
  }

  async function markAttended(registrationId: string) {
    setError(null);
    setBusyId(registrationId);
    const result = await markWellnessClassAttended(registrationId);
    setBusyId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onChanged();
  }

  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Workout classes &amp; health workshops</Text>
      <MutedText>Live sessions from partner instructors and studios, coming soon in your area.</MutedText>

      {classes.length === 0 && (
        <MutedText>Nothing scheduled yet; we&apos;re working on bringing partner classes to your area.</MutedText>
      )}

      {classes.length > 0 && (
        <View style={{ gap: 8 }}>
          {classes.map((cls) => {
            const registration = registrations.find((r) => r.class_id === cls.id);
            return (
              <View
                key={cls.id}
                style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 10 }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{cls.title}</Text>
                  <MutedText>
                    {classDateTime(cls.starts_at)} · {cls.duration_minutes} min ·{" "}
                    {cls.class_type === "virtual" ? "Virtual" : "In person"} · {cls.points_reward} pts
                  </MutedText>
                </View>
                {!registration && (
                  <Text
                    onPress={() => (busyId ? null : register(cls.id))}
                    style={{ fontSize: 12.5, fontWeight: "700", color: colors.brand, opacity: busyId === cls.id ? 0.5 : 1 }}
                  >
                    Register
                  </Text>
                )}
                {registration && registration.status === "registered" && (
                  <Text
                    onPress={() => (busyId ? null : markAttended(registration.id))}
                    style={{ fontSize: 12.5, fontWeight: "700", color: colors.brand, opacity: busyId === registration.id ? 0.5 : 1 }}
                  >
                    Mark attended
                  </Text>
                )}
                {registration && registration.status === "attended" && <StatusBadge text="Attended" tone="brand" />}
              </View>
            );
          })}
        </View>
      )}
      {error && <ErrorText>{error}</ErrorText>}
    </Card>
  );
}
