import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import { adolescentAgeBandFromDateOfBirth } from "@tarragon/shared";
import { postAdolescentHealthScreen, type AdolescentHealthScreenAnswers } from "@/lib/api";
import {
  loadLastAdolescentScreen,
  loadAdolescentTransitionPlan,
  loadSexualHealthSharing,
  grantSexualHealthSharing,
  revokeSexualHealthSharing,
  TRANSITION_STAGE_LABEL,
  TRANSITION_STAGES,
  type LastAdolescentScreen,
  type AdolescentTransitionPlan,
  type SexualHealthGrantee,
} from "@/lib/adolescent-health";
import { supabase } from "@/lib/supabase";
import { colors, radius, spacing } from "@/ui/theme";
import { Badge, Card, ErrorText, MutedText, PrimaryButton, ScreenTitle, SecondaryButton, SectionLabel } from "@/ui/components";

type YesNo = "yes" | "no";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

function YesNoQuestion({ prompt, value, onChange }: { prompt: string; value: YesNo | null; onChange: (v: YesNo) => void }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 13.5, color: colors.ink }}>{prompt}</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {(["no", "yes"] as const).map((opt) => (
          <Text
            key={opt}
            onPress={() => onChange(opt)}
            style={{
              fontSize: 13,
              paddingVertical: 7,
              paddingHorizontal: 14,
              borderRadius: radius.control,
              borderWidth: 1,
              borderColor: value === opt ? colors.brand : colors.border,
              backgroundColor: value === opt ? colors.brandTint : "transparent",
              color: colors.ink,
              textTransform: "capitalize",
            }}
          >
            {opt}
          </Text>
        ))}
      </View>
    </View>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 13.5, color: colors.ink }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="numeric"
        style={{
          width: 90,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.control,
          padding: 10,
          fontSize: 14,
          color: colors.ink,
        }}
      />
    </View>
  );
}

interface CheckInFormState {
  homeFeelsSafe: YesNo | null;
  homeHurtOrThreatened: YesNo | null;
  educationNote: string;
  daysActivePerWeek: string;
  sleepHoursPerNight: string;
  substanceUseLastMonth: YesNo | null;
  sexualHealthSupportRequested: YesNo | null;
  selfHarmThoughts: YesNo | null;
  unsafeElsewhere: YesNo | null;
  immediateDanger: YesNo | null;
  notes: string;
}

const EMPTY_FORM: CheckInFormState = {
  homeFeelsSafe: null,
  homeHurtOrThreatened: null,
  educationNote: "",
  daysActivePerWeek: "",
  sleepHoursPerNight: "",
  substanceUseLastMonth: null,
  sexualHealthSupportRequested: null,
  selfHarmThoughts: null,
  unsafeElsewhere: null,
  immediateDanger: null,
  notes: "",
};

/**
 * Native equivalent of apps/web/.../patient/adolescent-health/page.tsx +
 * adolescent-health-form.tsx + sharing-card.tsx (spec §49). The check-in
 * itself submits via postAdolescentHealthScreen (api.ts) to
 * /api/mobile/adolescent-health, which scores and writes server-side --
 * the same "never trust the client with a safety flag" shape as the
 * mental-health check-in. This is the one screen where a missed self-harm/
 * immediate-danger signal is the worst possible outcome of a native/web
 * drift, so the flagging language and gating below are copied, not
 * reworded.
 */
export function AdolescentHealthScreen({ isActingFor, actingForName }: { isActingFor: boolean; actingForName: string | null }) {
  const [loading, setLoading] = useState(true);
  const [dateOfBirth, setDateOfBirth] = useState<string | null>(null);
  const [lastScreen, setLastScreen] = useState<LastAdolescentScreen | null>(null);
  const [transitionPlan, setTransitionPlan] = useState<AdolescentTransitionPlan | null>(null);
  const [grantees, setGrantees] = useState<SexualHealthGrantee[]>([]);
  const [sharingPending, setSharingPending] = useState<string | null>(null);

  const [form, setForm] = useState<CheckInFormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    selfHarmFlagged?: boolean;
    immediateDangerFlagged?: boolean;
    abuseNeglectExploitationFlagged?: boolean;
  } | null>(null);

  useEffect(() => {
    if (isActingFor) {
      setLoading(false);
      return;
    }
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const [{ data: profile }, screenResult, planResult, sharingResult] = await Promise.all([
        user ? supabase.from("profiles").select("date_of_birth").eq("id", user.id).maybeSingle() : Promise.resolve({ data: null }),
        loadLastAdolescentScreen(),
        loadAdolescentTransitionPlan(),
        loadSexualHealthSharing(),
      ]);
      setDateOfBirth(profile?.date_of_birth ?? null);
      if (screenResult.ok) setLastScreen(screenResult.data);
      if (planResult.ok) setTransitionPlan(planResult.data);
      if (sharingResult.ok) setGrantees(sharingResult.data);
      setLoading(false);
    })();
  }, [isActingFor]);

  if (isActingFor) {
    return (
      <ScrollView contentContainerStyle={{ padding: spacing.screen, gap: 16 }}>
        <ScreenTitle>Adolescent Health</ScreenTitle>
        <Card style={{ backgroundColor: colors.groupBg }}>
          <MutedText>
            This check-in is private to {actingForName ?? "the person you support"} and only they can complete it,
            signed in as themselves. It isn&apos;t part of what you can see or do while looking after their account.
          </MutedText>
        </Card>
      </ScrollView>
    );
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  const ageBand = adolescentAgeBandFromDateOfBirth(dateOfBirth);
  const eligible = ageBand === "younger_adolescent" || ageBand === "older_adolescent";

  async function handleSubmit() {
    const required: [YesNo | null, string][] = [
      [form.homeFeelsSafe, "home safety"],
      [form.homeHurtOrThreatened, "home safety"],
      [form.substanceUseLastMonth, "substances"],
      [form.sexualHealthSupportRequested, "sexual health"],
      [form.selfHarmThoughts, "how you're doing"],
      [form.unsafeElsewhere, "how you're doing"],
      [form.immediateDanger, "how you're doing"],
    ];
    if (required.some(([v]) => v === null) || !form.daysActivePerWeek || !form.sleepHoursPerNight) {
      setError("Please answer every question");
      return;
    }
    setSubmitting(true);
    setError(null);
    const payload: AdolescentHealthScreenAnswers = {
      home_feels_safe: form.homeFeelsSafe!,
      home_hurt_or_threatened: form.homeHurtOrThreatened!,
      education_note: form.educationNote,
      days_active_per_week: Number(form.daysActivePerWeek),
      sleep_hours_per_night: Number(form.sleepHoursPerNight),
      substance_use_last_month: form.substanceUseLastMonth!,
      sexual_health_support_requested: form.sexualHealthSupportRequested!,
      self_harm_thoughts: form.selfHarmThoughts!,
      unsafe_elsewhere: form.unsafeElsewhere!,
      immediate_danger: form.immediateDanger!,
      notes: form.notes,
    };
    const res = await postAdolescentHealthScreen(payload);
    setSubmitting(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setResult(res);
  }

  async function handleShareToggle(grantee: SexualHealthGrantee) {
    setSharingPending(grantee.profileId);
    if (grantee.waiverId) {
      await revokeSexualHealthSharing(grantee.waiverId);
    } else {
      await grantSexualHealthSharing(grantee.profileId);
    }
    const refreshed = await loadSexualHealthSharing();
    if (refreshed.ok) setGrantees(refreshed.data);
    setSharingPending(null);
  }

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.screen, gap: 16 }}>
      <View>
        <ScreenTitle>Adolescent Health</ScreenTitle>
        <MutedText>
          A private, whole-life check-in (home, school, activity, and how you&apos;re really doing), plus your path
          towards looking after your own care as you get older.
        </MutedText>
      </View>

      {eligible && lastScreen && (
        <Card style={{ backgroundColor: colors.groupBg, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ fontSize: 13.5, color: colors.ink }}>Last check-in: {formatDate(lastScreen.createdAt)}</Text>
          <Badge tone={lastScreen.reviewedAt ? "brand" : "neutral"}>
            {lastScreen.reviewedAt ? "Reviewed by your care team" : "Awaiting review"}
          </Badge>
        </Card>
      )}

      {transitionPlan && (
        <Card style={{ gap: 8 }}>
          <SectionLabel>Your path to adult care</SectionLabel>
          <MutedText>
            We plan to move your care fully into your own hands by around age{" "}
            {transitionPlan.targetTransitionAge}. Your care team will walk you through this gradually. There&apos;s
            nothing to do here yourself yet.
          </MutedText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
            {TRANSITION_STAGES.map((stage) => (
              <Badge key={stage} tone={stage === transitionPlan.currentStage ? "brand" : "neutral"}>
                {TRANSITION_STAGE_LABEL[stage]}
              </Badge>
            ))}
          </View>
        </Card>
      )}

      {!eligible ? (
        <Card style={{ backgroundColor: colors.groupBg }}>
          <MutedText>
            {ageBand === "child"
              ? "This check-in is designed for older children and teenagers to complete themselves. It isn't the right place to log something on behalf of a younger child."
              : "This particular check-in is designed for the adolescent years. Your care team's regular wellbeing check-ins cover this for you."}
          </MutedText>
        </Card>
      ) : (
        <>
          {grantees.length > 0 && (
            <Card style={{ gap: 10 }}>
              <SectionLabel>Sharing your sexual &amp; reproductive health info</SectionLabel>
              <MutedText>
                This is off by default and stays that way unless you turn it on. You can change your mind at any
                time.
              </MutedText>
              {grantees.map((grantee) => {
                const isShared = grantee.waiverId !== null;
                return (
                  <View
                    key={grantee.profileId}
                    style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={{ fontSize: 13.5, color: colors.ink }}>
                        {grantee.fullName ?? "Someone with access to your record"}
                      </Text>
                      <Badge tone={isShared ? "brand" : "neutral"}>{isShared ? "Sharing" : "Not shared"}</Badge>
                    </View>
                    <SecondaryButton
                      title={isShared ? "Stop sharing" : "Share"}
                      loading={sharingPending === grantee.profileId}
                      onPress={() => void handleShareToggle(grantee)}
                    />
                  </View>
                );
              })}
            </Card>
          )}

          {result ? (
            <Card style={{ gap: 8 }}>
              <SectionLabel>Thanks for checking in</SectionLabel>
              <MutedText>Your answers are saved and stay private to your care team.</MutedText>
              {(result.selfHarmFlagged || result.immediateDangerFlagged) && (
                <View style={{ backgroundColor: "#FEF2F2", borderRadius: radius.card, padding: 12 }}>
                  <Text style={{ color: "#B91C1C", fontSize: 13.5 }}>
                    You told us something worrying. You are not alone. A member of your care team will reach out to
                    you directly. If you are in immediate danger, please contact emergency services or go to the
                    nearest hospital now.
                  </Text>
                </View>
              )}
              {result.abuseNeglectExploitationFlagged && !result.selfHarmFlagged && !result.immediateDangerFlagged && (
                <View style={{ backgroundColor: "#FFFBEB", borderRadius: radius.card, padding: 12 }}>
                  <Text style={{ color: "#92400E", fontSize: 13.5 }}>
                    You told us something that matters. A senior member of your care team will look into this
                    carefully and privately. This is shared with someone else only where your safety has to come
                    first.
                  </Text>
                </View>
              )}
            </Card>
          ) : (
            <Card style={{ gap: 18 }}>
              <View>
                <SectionLabel>Your whole-life check-in</SectionLabel>
                <MutedText>
                  A few questions about home, school, activity, and how you&apos;re really doing, the kind of thing
                  a doctor might ask in person. There are no wrong answers, and your answers stay private to your
                  care team.
                </MutedText>
              </View>

              <View style={{ gap: 12 }}>
                <Text style={{ fontSize: 11, fontWeight: "700", color: colors.brandPressed, textTransform: "uppercase" }}>
                  Home
                </Text>
                <YesNoQuestion
                  prompt="Do you feel safe at home?"
                  value={form.homeFeelsSafe}
                  onChange={(v) => setForm((f) => ({ ...f, homeFeelsSafe: v }))}
                />
                <YesNoQuestion
                  prompt="Has anyone at home hurt you, threatened you, or made you feel unsafe recently?"
                  value={form.homeHurtOrThreatened}
                  onChange={(v) => setForm((f) => ({ ...f, homeHurtOrThreatened: v }))}
                />
              </View>

              <View style={{ gap: 8 }}>
                <Text style={{ fontSize: 11, fontWeight: "700", color: colors.brandPressed, textTransform: "uppercase" }}>
                  School and everyday life
                </Text>
                <Text style={{ fontSize: 13.5, color: colors.ink }}>
                  Anything you&apos;d like to share about school or how things are going day to day? (optional)
                </Text>
                <TextInput
                  value={form.educationNote}
                  onChangeText={(v) => setForm((f) => ({ ...f, educationNote: v }))}
                  maxLength={500}
                  multiline
                  numberOfLines={2}
                  style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 10, fontSize: 14, color: colors.ink }}
                />
              </View>

              <View style={{ gap: 12 }}>
                <Text style={{ fontSize: 11, fontWeight: "700", color: colors.brandPressed, textTransform: "uppercase" }}>
                  Activity and sleep
                </Text>
                <NumberField
                  label="In a typical week, how many days are you physically active?"
                  value={form.daysActivePerWeek}
                  onChange={(v) => setForm((f) => ({ ...f, daysActivePerWeek: v.replace(/[^0-9]/g, "") }))}
                />
                <NumberField
                  label="On a typical night, how many hours do you sleep?"
                  value={form.sleepHoursPerNight}
                  onChange={(v) => setForm((f) => ({ ...f, sleepHoursPerNight: v.replace(/[^0-9.]/g, "") }))}
                />
              </View>

              <View style={{ gap: 12 }}>
                <Text style={{ fontSize: 11, fontWeight: "700", color: colors.brandPressed, textTransform: "uppercase" }}>
                  Substances
                </Text>
                <YesNoQuestion
                  prompt="In the last month, have you used alcohol, cigarettes, vaping, or any other substance?"
                  value={form.substanceUseLastMonth}
                  onChange={(v) => setForm((f) => ({ ...f, substanceUseLastMonth: v }))}
                />
              </View>

              <View style={{ gap: 12 }}>
                <Text style={{ fontSize: 11, fontWeight: "700", color: colors.brandPressed, textTransform: "uppercase" }}>
                  Sexual health
                </Text>
                <YesNoQuestion
                  prompt="Would you like confidential information or support about sexual health (e.g. contraception, STI testing)?"
                  value={form.sexualHealthSupportRequested}
                  onChange={(v) => setForm((f) => ({ ...f, sexualHealthSupportRequested: v }))}
                />
              </View>

              <View style={{ gap: 12 }}>
                <Text style={{ fontSize: 11, fontWeight: "700", color: colors.brandPressed, textTransform: "uppercase" }}>
                  How you&apos;re really doing
                </Text>
                <YesNoQuestion
                  prompt="In the last two weeks, have you had thoughts of hurting yourself, or that life isn't worth living?"
                  value={form.selfHarmThoughts}
                  onChange={(v) => setForm((f) => ({ ...f, selfHarmThoughts: v }))}
                />
                <YesNoQuestion
                  prompt="Do you feel unsafe anywhere else in your life right now, at school, online, or elsewhere?"
                  value={form.unsafeElsewhere}
                  onChange={(v) => setForm((f) => ({ ...f, unsafeElsewhere: v }))}
                />
                <YesNoQuestion
                  prompt="Are you in danger right now and need help immediately?"
                  value={form.immediateDanger}
                  onChange={(v) => setForm((f) => ({ ...f, immediateDanger: v }))}
                />
                <Text style={{ fontSize: 13.5, color: colors.ink }}>Anything else you want us to know? (optional)</Text>
                <TextInput
                  value={form.notes}
                  onChangeText={(v) => setForm((f) => ({ ...f, notes: v }))}
                  maxLength={1000}
                  multiline
                  numberOfLines={2}
                  style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 10, fontSize: 14, color: colors.ink }}
                />
              </View>

              {error ? <ErrorText>{error}</ErrorText> : null}
              <PrimaryButton title="Save check-in" loading={submitting} onPress={() => void handleSubmit()} />
            </Card>
          )}
        </>
      )}
    </ScrollView>
  );
}
