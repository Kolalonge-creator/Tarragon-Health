import { useEffect, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import {
  clearSexualHealthPin,
  isCurrentlyLocked,
  loadSexualHealthPrivacyStatus,
  setSexualHealthPin,
  verifySexualHealthPin,
  type SexualHealthPrivacyStatus,
} from "@/lib/sexual-health-privacy";
import {
  CONTRACEPTION_CATEGORY_LABEL,
  CONTRACEPTION_STATUS_LABEL,
  loadContraceptionMethods,
  loadContraceptionPlans,
  requestContraceptionMethod,
  requestEmergencyContraception,
  type ContraceptionMethod,
  type ContraceptionMethodCategory,
  type ContraceptionPlan,
} from "@/lib/contraception";
import {
  FERTILITY_RESULT_COPY,
  KNOWN_RISK_FACTORS,
  KNOWN_RISK_FACTOR_LABEL,
  submitFertilityAssessment,
  type FertilityRecommendedAction,
  type KnownRiskFactor,
} from "@/lib/fertility";
import {
  INSTRUMENT_CONFIG,
  SEXUAL_HEALTH_INSTRUMENTS,
  SEXUAL_HEALTH_INSTRUMENT_LABEL,
  SEXUAL_HEALTH_SEVERITY_BAND_LABEL,
  SEXUAL_HEALTH_SEVERITY_COPY,
  submitSexualHealthScreen,
  type SexualHealthInstrument,
  type SexualWellnessResult,
} from "@/lib/sexual-wellness";
import { CONFIDENTIAL_MESSAGE_CREDIT_REQUIRED_MARKER, startConfidentialSrhThread } from "@/lib/confidential-message";
import { PLATFORM_URL } from "@/lib/platform-url";
import { SexualHealthResultsTab, SexualHealthTestingTab } from "@/screens/sections/sexual-health-testing-tab";
import type { SectionId } from "@/lib/sections";
import { colors, radius, spacing } from "@/ui/theme";
import { Card, ErrorText, MutedText, PrimaryButton, ScreenTitle, SecondaryButton } from "@/ui/components";

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

const TABS = [
  { key: "testing", label: "Testing" },
  { key: "results", label: "My results" },
  { key: "contraception", label: "Contraception" },
  { key: "fertility", label: "Fertility" },
  { key: "wellness", label: "Wellness" },
  { key: "learn", label: "Learn" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

interface SexualHealthScreenProps {
  userId: string;
  organisationId: string;
  onNavigate: (section: SectionId) => void;
}

/**
 * "Sexual & reproductive health" (spec §47) — PIN-gated (shared-device
 * privacy, not a security boundary), then a 6-tab hub mirroring
 * apps/web/.../patient/sexual-health/sexual-health-hub.tsx. **Every table
 * this module touches is patient-self-or-org-staff only by construction, no
 * profile_access/supporter/can_act_for path at all — this screen (and every
 * lib/*.ts function it calls) uses `userId`/`organisationId` (the device
 * owner's OWN ids) exclusively, never subjectId/getActingFor().** See
 * docs/mobile-native-conversion/sexual-health.md's safety notes before
 * changing anything here.
 */
export function SexualHealthScreen({ userId, organisationId, onNavigate }: SexualHealthScreenProps) {
  const [status, setStatus] = useState<SexualHealthPrivacyStatus | null>(null);
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    loadSexualHealthPrivacyStatus()
      .then(setStatus)
      .catch(() => setStatus({ hasPin: false, lockedUntil: null }));
  }, []);

  // Renders nothing until the "does a PIN even exist" check resolves, so the
  // hub never flashes before a lock can apply — same discipline as web's
  // SexualHealthPrivacyGate.
  if (status === null) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  if (status.hasPin && !unlocked) {
    return <PrivacyGate status={status} onUnlocked={() => setUnlocked(true)} onStatusChanged={setStatus} />;
  }

  return (
    <SexualHealthHub
      userId={userId}
      organisationId={organisationId}
      privacyStatus={status}
      onPrivacyChanged={setStatus}
      onNavigate={onNavigate}
    />
  );
}

function PrivacyGate({
  status,
  onUnlocked,
  onStatusChanged,
}: {
  status: SexualHealthPrivacyStatus;
  onUnlocked: () => void;
  onStatusChanged: (s: SexualHealthPrivacyStatus) => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [clearing, setClearing] = useState(false);

  const isLocked = isCurrentlyLocked(status.lockedUntil);

  async function submit() {
    setError(null);
    setVerifying(true);
    const result = await verifySexualHealthPin(pin);
    setVerifying(false);
    setPin("");
    if (!result.ok) {
      onStatusChanged({ ...status, lockedUntil: result.locked ? new Date(Date.now() + 5 * 60_000).toISOString() : status.lockedUntil });
      setError(result.locked ? "Too many attempts. Try again in a few minutes, or reset your PIN below." : "Something went wrong. Please try again.");
      return;
    }
    if (result.correct) {
      onUnlocked();
    } else {
      setError("That PIN didn't match. Try again.");
    }
  }

  async function reset() {
    setClearing(true);
    await clearSexualHealthPin();
    setClearing(false);
    onStatusChanged({ hasPin: false, lockedUntil: null });
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", padding: spacing.screen, gap: 14 }}>
      <Text style={{ fontSize: 16, fontWeight: "700", color: colors.ink }}>Enter your privacy PIN</Text>
      <MutedText>You set this up so this section stays private on shared devices.</MutedText>

      {isLocked ? (
        <MutedText>Too many attempts. Try again shortly, or reset your PIN below.</MutedText>
      ) : (
        <View style={{ width: "100%", maxWidth: 240, gap: 10 }}>
          <TextInput
            value={pin}
            onChangeText={(t) => setPin(t.replace(/\D/g, ""))}
            secureTextEntry
            keyboardType="number-pad"
            maxLength={6}
            placeholder="••••"
            style={[textInputStyle, { textAlign: "center", fontSize: 20, letterSpacing: 8 }]}
          />
          {error && <ErrorText>{error}</ErrorText>}
          <PrimaryButton title="Unlock" onPress={submit} disabled={pin.length < 4} loading={verifying} />
        </View>
      )}

      <Text onPress={reset} style={{ fontSize: 12.5, fontWeight: "600", color: colors.muted, textDecorationLine: "underline" }}>
        {clearing ? "Resetting…" : "Forgot your PIN? Reset it"}
      </Text>
    </View>
  );
}

function SexualHealthHub({
  userId,
  organisationId,
  privacyStatus,
  onPrivacyChanged,
  onNavigate,
}: {
  userId: string;
  organisationId: string;
  privacyStatus: SexualHealthPrivacyStatus;
  onPrivacyChanged: (s: SexualHealthPrivacyStatus) => void;
  onNavigate: (section: SectionId) => void;
}) {
  const [tab, setTab] = useState<TabKey>("testing");

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ paddingHorizontal: spacing.screen, paddingTop: spacing.screen, gap: 10 }}>
        <ScreenTitle>Sexual & reproductive health</ScreenTitle>
        <MutedText>Testing, contraception, fertility, and wellness: private, and reviewed by your care team.</MutedText>
        <View style={{ borderWidth: 1, borderColor: colors.navy, backgroundColor: colors.groupBg, borderRadius: radius.control, padding: 10 }}>
          <Text style={{ fontSize: 11.5, fontWeight: "600", color: colors.navy }}>
            Your answers here stay between you and your care team, never shown to a family member, an
            employer, or an HMO, even one that pays for your plan.
          </Text>
        </View>
        <PrivacySettingsRow status={privacyStatus} onChanged={onPrivacyChanged} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, paddingVertical: 10 }} contentContainerStyle={{ paddingHorizontal: spacing.screen, gap: 8 }}>
        {TABS.map((t) => (
          <Chip key={t.key} label={t.label} active={tab === t.key} onPress={() => setTab(t.key)} />
        ))}
      </ScrollView>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.screen, paddingTop: 0, gap: 16 }}>
        {tab === "testing" && <SexualHealthTestingTab />}
        {tab === "results" && <SexualHealthResultsTab patientId={userId} organisationId={organisationId} />}
        {tab === "contraception" && (
          <>
            <EmergencyContraceptionCard userId={userId} organisationId={organisationId} />
            <ContraceptionCard userId={userId} organisationId={organisationId} />
          </>
        )}
        {tab === "fertility" && <FertilityCard />}
        {tab === "wellness" && <SexualWellnessCard />}
        {tab === "learn" && <LearnCard onOpenLearn={() => onNavigate("learn")} />}

        <ConfidentialMessageCard />
      </ScrollView>
    </View>
  );
}

function PrivacySettingsRow({ status, onChanged }: { status: SexualHealthPrivacyStatus; onChanged: (s: SexualHealthPrivacyStatus) => void }) {
  const [editing, setEditing] = useState(false);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [clearing, setClearing] = useState(false);

  async function save() {
    setError(null);
    if (!/^\d{4,6}$/.test(pin)) {
      setError("PIN must be 4 to 6 digits.");
      return;
    }
    if (pin !== confirmPin) {
      setError("The two PINs don't match.");
      return;
    }
    setSubmitting(true);
    const result = await setSexualHealthPin(pin);
    setSubmitting(false);
    if (!result.ok) {
      setError("Couldn't save that PIN. Please try again.");
      return;
    }
    setEditing(false);
    setPin("");
    setConfirmPin("");
    onChanged({ hasPin: true, lockedUntil: null });
  }

  async function remove() {
    setClearing(true);
    await clearSexualHealthPin();
    setClearing(false);
    onChanged({ hasPin: false, lockedUntil: null });
  }

  return (
    <Card style={{ gap: 8 }}>
      <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink }}>Privacy PIN</Text>
      <MutedText>
        {status.hasPin ? "This section asks for a PIN before it opens, useful on a shared phone." : "Add a PIN so this section doesn't open right away on a shared phone. Completely optional."}
      </MutedText>
      {!editing ? (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <SecondaryButton title={status.hasPin ? "Change PIN" : "Set up a PIN"} onPress={() => setEditing(true)} />
          {status.hasPin && <SecondaryButton title={clearing ? "Removing…" : "Remove PIN"} onPress={remove} loading={clearing} />}
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <TextInput value={pin} onChangeText={(t) => setPin(t.replace(/\D/g, ""))} secureTextEntry keyboardType="number-pad" maxLength={6} placeholder="New PIN (4-6 digits)" style={textInputStyle} />
          <TextInput value={confirmPin} onChangeText={(t) => setConfirmPin(t.replace(/\D/g, ""))} secureTextEntry keyboardType="number-pad" maxLength={6} placeholder="Confirm PIN" style={textInputStyle} />
          {error && <ErrorText>{error}</ErrorText>}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <PrimaryButton title="Save PIN" onPress={save} loading={submitting} />
            <SecondaryButton
              title="Cancel"
              onPress={() => {
                setEditing(false);
                setPin("");
                setConfirmPin("");
                setError(null);
              }}
            />
          </View>
        </View>
      )}
    </Card>
  );
}

function EmergencyContraceptionCard({ userId, organisationId }: { userId: string; organisationId: string }) {
  const [hours, setHours] = useState("");
  const [notSure, setNotSure] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guidance, setGuidance] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setSubmitting(true);
    const hoursValue = notSure || !hours ? null : Number(hours);
    const result = await requestEmergencyContraception(userId, organisationId, hoursValue);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setGuidance(result.data.guidance);
  }

  if (guidance) {
    return (
      <Card style={{ borderColor: colors.brand, backgroundColor: colors.brandTint, gap: 8 }}>
        <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Request received</Text>
        <Text style={{ fontSize: 13, color: colors.ink }}>{guidance}</Text>
        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.brandPressed }}>Your care team has been notified and will follow up quickly.</Text>
      </Card>
    );
  }

  return (
    <Card style={{ borderColor: colors.brand, backgroundColor: colors.brandTint, gap: 10 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Need emergency contraception?</Text>
      <MutedText>
        Timing matters here, but there is almost always still something that can help. Tell us roughly
        when, and your care team will follow up fast.
      </MutedText>
      <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>Hours since intercourse</Text>
      <TextInput
        value={hours}
        onChangeText={setHours}
        keyboardType="numeric"
        placeholder="e.g. 6"
        editable={!notSure}
        style={[textInputStyle, notSure ? { opacity: 0.5 } : null]}
      />
      <Text onPress={() => setNotSure((v) => !v)} style={{ fontSize: 13, color: colors.ink }}>
        <Text style={{ fontWeight: "700", color: notSure ? colors.brand : colors.faint }}>{notSure ? "☑ " : "☐ "}</Text>
        I&apos;m not sure
      </Text>
      {error && <ErrorText>{error}</ErrorText>}
      <PrimaryButton title="Request emergency contraception" onPress={submit} loading={submitting} />
    </Card>
  );
}

function ContraceptionCard({ userId, organisationId }: { userId: string; organisationId: string }) {
  const [methods, setMethods] = useState<ContraceptionMethod[]>([]);
  const [plans, setPlans] = useState<ContraceptionPlan[]>([]);
  const [requesting, setRequesting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    loadContraceptionMethods().then(setMethods).catch(() => {});
    loadContraceptionPlans(userId).then(setPlans).catch(() => {});
  }

  useEffect(refresh, [userId]);

  async function request(methodCode: string) {
    setError(null);
    setRequesting(methodCode);
    const result = await requestContraceptionMethod(userId, organisationId, methodCode);
    setRequesting(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    refresh();
  }

  const grouped = new Map<ContraceptionMethodCategory, ContraceptionMethod[]>();
  for (const m of methods) {
    if (m.category === "emergency") continue;
    const list = grouped.get(m.category) ?? [];
    list.push(m);
    grouped.set(m.category, list);
  }
  const methodNameByCode = new Map(methods.map((m) => [m.code, m.name]));

  return (
    <>
      <Card style={{ gap: 12 }}>
        <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Contraception methods</Text>
        <MutedText>
          Compare methods in plain language, then request the one that fits you. Your care team will
          follow up before anything is prescribed.
        </MutedText>
        {error && <ErrorText>{error}</ErrorText>}
        {[...grouped.entries()].map(([category, categoryMethods]) => (
          <View key={category} style={{ gap: 8 }}>
            <Text style={{ fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.3, color: colors.brandPressed }}>
              {CONTRACEPTION_CATEGORY_LABEL[category]}
            </Text>
            {categoryMethods.map((method) => (
              <View key={method.code} style={{ borderWidth: 1, borderColor: colors.brandTint, backgroundColor: colors.brandTint, borderRadius: radius.control, padding: 10, gap: 6 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink, flex: 1 }}>{method.name}</Text>
                  {method.requires_prescription && (
                    <Text style={{ fontSize: 10.5, fontWeight: "700", color: colors.navy }}>Needs a clinician</Text>
                  )}
                </View>
                <MutedText>{method.description}</MutedText>
                {method.typical_effectiveness_pct != null && <MutedText>About {method.typical_effectiveness_pct}% effective with typical use</MutedText>}
                <SecondaryButton title="Request this method" onPress={() => request(method.code)} loading={requesting === method.code} />
              </View>
            ))}
          </View>
        ))}
      </Card>

      <Card style={{ gap: 8 }}>
        <Text style={{ fontSize: 13.5, fontWeight: "700", color: colors.ink }}>Your contraception plans</Text>
        {plans.length === 0 && <MutedText>You haven&apos;t requested a method yet. Browse above whenever you&apos;re ready.</MutedText>}
        {plans.map((plan) => (
          <View key={plan.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 10 }}>
            <View>
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{methodNameByCode.get(plan.method_code) ?? plan.method_code.replace(/_/g, " ")}</Text>
              <MutedText>Requested {when(plan.requested_at)}</MutedText>
            </View>
            <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted }}>{CONTRACEPTION_STATUS_LABEL[plan.status]}</Text>
          </View>
        ))}
      </Card>
    </>
  );
}

function when(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

function FertilityCard() {
  const [months, setMonths] = useState("");
  const [cycleRegular, setCycleRegular] = useState<boolean | undefined>();
  const [riskFactors, setRiskFactors] = useState<KnownRiskFactor[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FertilityRecommendedAction | null>(null);

  function toggle(factor: KnownRiskFactor) {
    setRiskFactors((prev) => {
      if (factor === "none") return prev.includes("none") ? [] : ["none"];
      const withoutNone = prev.filter((f) => f !== "none");
      return withoutNone.includes(factor) ? withoutNone.filter((f) => f !== factor) : [...withoutNone, factor];
    });
  }

  async function submit() {
    setError(null);
    const monthsValue = Number(months);
    if (!months || Number.isNaN(monthsValue)) {
      setError("Enter a number of months");
      return;
    }
    setSubmitting(true);
    const submitResult = await submitFertilityAssessment({
      trying_duration_months: monthsValue,
      menstrual_cycle_regular: cycleRegular,
      known_risk_factors: riskFactors,
    });
    setSubmitting(false);
    if (!submitResult.ok) {
      setError(submitResult.error);
      return;
    }
    setResult(submitResult.data);
  }

  if (result) {
    const copy = FERTILITY_RESULT_COPY[result];
    return (
      <Card style={{ gap: 8 }}>
        <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>{copy.title}</Text>
        <MutedText>{copy.description}</MutedText>
      </Card>
    );
  }

  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Fertility check-in</Text>
      <MutedText>
        A few quick questions to point you toward the right next step: education, advice, baseline
        tests, or a specialist. Never a diagnosis.
      </MutedText>
      <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>How many months have you been trying to conceive?</Text>
      <TextInput value={months} onChangeText={setMonths} keyboardType="numeric" placeholder="e.g. 8" style={[textInputStyle, { maxWidth: 120 }]} />

      <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>Is your menstrual cycle regular? (Skip if this doesn&apos;t apply)</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Chip label="Yes, regular" active={cycleRegular === true} onPress={() => setCycleRegular(true)} />
        <Chip label="No, irregular" active={cycleRegular === false} onPress={() => setCycleRegular(false)} />
      </View>

      <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>Do any of these apply to you or your partner?</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {KNOWN_RISK_FACTORS.map((f) => (
          <Chip key={f} label={KNOWN_RISK_FACTOR_LABEL[f]} active={riskFactors.includes(f)} onPress={() => toggle(f)} />
        ))}
      </View>

      {error && <ErrorText>{error}</ErrorText>}
      <PrimaryButton title="Get my recommendation" onPress={submit} loading={submitting} />
    </Card>
  );
}

function SexualWellnessCard() {
  const [view, setView] = useState<"picker" | "form" | "result">("picker");
  const [instrument, setInstrument] = useState<SexualHealthInstrument | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SexualWellnessResult | null>(null);

  function pick(next: SexualHealthInstrument) {
    setInstrument(next);
    setAnswers({});
    setView("form");
  }

  function checkAnother() {
    setInstrument(null);
    setResult(null);
    setView("picker");
  }

  async function submit() {
    if (!instrument) return;
    const items = Array.from({ length: 5 }, (_, i) => answers[i]);
    if (items.some((v) => v === undefined)) {
      setError("Please answer every question");
      return;
    }
    setError(null);
    setSubmitting(true);
    const submitResult = await submitSexualHealthScreen(instrument, items);
    setSubmitting(false);
    if (!submitResult.ok) {
      setError(submitResult.error);
      return;
    }
    setResult(submitResult.data);
    setView("result");
  }

  return (
    <Card style={{ gap: 12 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Sexual wellness</Text>
      <MutedText>A short, private check-in: never a diagnosis, and only your care team can see it.</MutedText>

      {view === "picker" && (
        <View style={{ gap: 8 }}>
          {SEXUAL_HEALTH_INSTRUMENTS.map((option) => (
            <Text
              key={option}
              onPress={() => pick(option)}
              style={{ borderWidth: 1, borderColor: colors.brand, backgroundColor: colors.brandTint, borderRadius: radius.control, padding: 12, fontSize: 13.5, fontWeight: "600", color: colors.ink }}
            >
              {SEXUAL_HEALTH_INSTRUMENT_LABEL[option]}
            </Text>
          ))}
        </View>
      )}

      {view === "form" && instrument && (
        <View style={{ gap: 14 }}>
          <MutedText>{SEXUAL_HEALTH_INSTRUMENT_LABEL[instrument]}, over the last few weeks:</MutedText>
          {INSTRUMENT_CONFIG[instrument].questions.map((prompt, i) => (
            <View key={i} style={{ gap: 6 }}>
              <Text style={{ fontSize: 13, color: colors.ink }}>{prompt}</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {INSTRUMENT_CONFIG[instrument].options.map((opt) => (
                  <Chip key={opt.value} label={opt.label} active={answers[i] === opt.value} onPress={() => setAnswers((prev) => ({ ...prev, [i]: opt.value }))} />
                ))}
              </View>
            </View>
          ))}
          {error && <ErrorText>{error}</ErrorText>}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <PrimaryButton title="Get my result" onPress={submit} loading={submitting} />
            <SecondaryButton title="Back" onPress={checkAnother} disabled={submitting} />
          </View>
        </View>
      )}

      {view === "result" && result && instrument && (
        <View style={{ gap: 10 }}>
          <View style={{ backgroundColor: colors.brandTint, borderRadius: radius.control, padding: 12, gap: 4 }}>
            <Text style={{ fontSize: 11, fontWeight: "700", textTransform: "uppercase", color: colors.brandPressed }}>
              {SEXUAL_HEALTH_INSTRUMENT_LABEL[instrument]}: {SEXUAL_HEALTH_SEVERITY_BAND_LABEL[result.severityBand]}
            </Text>
            <Text style={{ fontSize: 13, color: colors.ink }}>{SEXUAL_HEALTH_SEVERITY_COPY[result.severityBand]}</Text>
          </View>
          {result.cardiometabolicFlag && (
            <View style={{ borderWidth: 1, borderColor: colors.status.warn, backgroundColor: colors.status.warnBg, borderRadius: radius.control, padding: 12, gap: 6 }}>
              <Text style={{ fontSize: 13, color: colors.ink }}>
                Sexual health is often connected to heart and metabolic health. It&apos;s worth checking your
                cardiovascular risk too.
              </Text>
            </View>
          )}
          <SecondaryButton title="Check a different concern" onPress={checkAnother} />
        </View>
      )}
    </Card>
  );
}

function LearnCard({ onOpenLearn }: { onOpenLearn: () => void }) {
  return (
    <Card style={{ gap: 8 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Learn</Text>
      <MutedText>Plain-language reading on fertility, contraception, consent, and related health topics.</MutedText>
      <SecondaryButton title="Browse everything in Learn" onPress={onOpenLearn} />
    </Card>
  );
}

function ConfidentialMessageCard() {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [needsCredit, setNeedsCredit] = useState(false);

  async function send() {
    setError(null);
    setNeedsCredit(false);
    setPending(true);
    const result = await startConfidentialSrhThread(subject, body);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      if (result.error.includes(CONFIDENTIAL_MESSAGE_CREDIT_REQUIRED_MARKER)) {
        setNeedsCredit(true);
      }
      return;
    }
    setSubject("");
    setBody("");
    setOpen(false);
    setSent(true);
  }

  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Message your care team confidentially</Text>
      <MutedText>
        For anything here you&apos;d rather write than say out loud. This thread is hidden from anyone else
        who supports your care, even someone with their usual access to your record. A doctor reads and
        replies, so this is a paid message (₦2,500).
      </MutedText>

      {sent && <MutedText>Sent. Your care team will reply in Messages.</MutedText>}

      {!open && (
        <SecondaryButton title={sent ? "Send another confidential message" : "Start a confidential message"} onPress={() => setOpen(true)} />
      )}

      {open && (
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>Subject</Text>
          <TextInput value={subject} onChangeText={setSubject} placeholder="e.g. Question about my result" maxLength={150} style={textInputStyle} />
          <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>Message</Text>
          <TextInput value={body} onChangeText={setBody} multiline numberOfLines={4} maxLength={4000} style={[textInputStyle, { minHeight: 90, textAlignVertical: "top" }]} />
          {error && <ErrorText>{error}</ErrorText>}

          {needsCredit ? (
            <SecondaryButton
              title="Buy a credit in the browser"
              onPress={() => void WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/sexual-health`)}
            />
          ) : (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <PrimaryButton title="Send" onPress={send} disabled={subject.trim().length < 3 || body.trim().length === 0} loading={pending} />
              <SecondaryButton title="Cancel" onPress={() => setOpen(false)} disabled={pending} />
            </View>
          )}
        </View>
      )}
    </Card>
  );
}
