import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, ScrollView, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import {
  LIPID_ANALYTE_CODES,
  LIPID_ANALYTE_META,
  RISK_LEVEL_COPY,
  SCORE_TYPE_LABEL,
  confirmVideoSlot,
  loadHealthCheckState,
  loadLipidProfile,
  loadRiskSignals,
  type HealthCheckState,
  type HealthCheckVideoConsult,
  type LipidProfile,
  type RiskSignal,
} from "@/lib/health-check";
import type { SectionId } from "@/lib/sections";
import { PLATFORM_URL } from "@/lib/platform-url";
import { colors, radius, spacing } from "@/ui/theme";
import { CalloutCard, Card, ErrorText, MutedText, ScreenTitle, SecondaryButton } from "@/ui/components";

function when(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

function formatSlot(iso: string): string {
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
  warn: { bg: colors.status.warnBg, text: colors.status.warn },
} as const;

function StatusBadge({ text, tone }: { text: string; tone: keyof typeof TONE_COLOR }) {
  const c = TONE_COLOR[tone];
  return (
    <View style={{ backgroundColor: c.bg, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 }}>
      <Text style={{ fontSize: 11, fontWeight: "600", color: c.text }}>{text}</Text>
    </View>
  );
}

interface HealthCheckScreenProps {
  patientId: string;
  onNavigate: (section: SectionId) => void;
}

const STAGE_NAV: SectionId[] = ["prevention", "wellbeing", "vitals", "prevention", "prevention"];

/**
 * "Your Health Check" — the yearly Annual Health Check's 5-stage dashboard,
 * doctor review/report card, and video-consult slot picker, mirroring
 * apps/web/.../patient/health-check/page.tsx's orchestration layer.
 * Everything with an existing native home elsewhere is a link-out, not a
 * rebuild: mental wellbeing (`wellbeing`), risk-assessment/screening/
 * vaccination questionnaires (`prevention`), and viewing/uploading lab
 * orders & results (Labs) are all native screens today. The one thing that
 * stays a system-browser hand-off, below, is redeeming a Care Voucher —
 * real Paystack checkout/payment, same reasoning as Subscription elsewhere
 * in this app. Booking self-arranged lab work no longer needs a hand-off of
 * its own (every panel_bundle is guidance_only, 2026-09-10 — Tarragon
 * doesn't bill for or book any test), but the print-a-request action still
 * lives on the web page for now, so the callout still points there.
 */
export function HealthCheckScreen({ patientId, onNavigate }: HealthCheckScreenProps) {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<HealthCheckState | null>(null);
  const [lipids, setLipids] = useState<LipidProfile | null>(null);
  const [riskSignals, setRiskSignals] = useState<RiskSignal[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [checkResult, lipidProfile, signals] = await Promise.all([
      loadHealthCheckState(patientId),
      loadLipidProfile(patientId),
      loadRiskSignals(patientId),
    ]);
    if (checkResult.ok) {
      setState(checkResult.data);
      setError(null);
    } else {
      setError(checkResult.error);
    }
    setLipids(lipidProfile);
    setRiskSignals(signals);
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

  if (!state) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background, padding: spacing.screen }}>
        <ErrorText>{error ?? "Could not load your Health Check just now."}</ErrorText>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.screen, gap: 16 }}
    >
      <View>
        <ScreenTitle>Your Health Check</ScreenTitle>
        <MutedText>
          A yearly, whole-body check: the right checks for you, and a plan to keep you well. Work through
          each step; your care team reviews everything at the end.
        </MutedText>
        {state.tierName && <MutedText>You&apos;re completing the {state.tierName} this year.</MutedText>}
      </View>

      <Card style={{ gap: 0 }}>
        <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink, marginBottom: 6 }}>Your {state.year} check</Text>
        {state.stages.map((stage, i) => (
          <View
            key={stage.title}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              paddingVertical: 10,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: colors.border,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13.5, fontWeight: "600", color: colors.ink }}>{stage.title}</Text>
              <MutedText>{stage.label}</MutedText>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {stage.state !== "neutral" && (
                <StatusBadge text={stage.state === "done" ? "Done" : "To do"} tone={stage.state === "done" ? "brand" : "warn"} />
              )}
              <Text onPress={() => onNavigate(STAGE_NAV[i])} style={{ fontSize: 12.5, fontWeight: "700", color: colors.brand }}>
                Open →
              </Text>
            </View>
          </View>
        ))}
      </Card>

      <CalloutCard
        icon="flask-outline"
        title="Health checks & screenings"
        // Care Voucher redemption is a real Paystack checkout/payment flow —
        // system-browser hand-off, never an embedded WebView, same reasoning
        // as Subscription elsewhere in this app. Uploading a result and
        // viewing orders/results already has a real native home in the Labs
        // section. Getting and printing a self-arranged request currently
        // only lives on this web page too (no native print/order flow yet).
        subtitle="Get and print a lab request, or use a Care Voucher, on the web."
        ctaLabel="Open health checks"
        onPress={() => void WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/health-check`)}
      />

      {lipids && lipids.latestDrawnAt && <LipidProfileCard lipids={lipids} />}
      {riskSignals.length > 0 && <RiskSignalsCard signals={riskSignals} />}

      <Card style={{ gap: 6 }}>
        <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Review &amp; communicate</Text>
        {state.reviewedAt ? (
          <>
            <MutedText>
              Completed{state.reviewerName ? ` · Reviewed by ${state.reviewerName}` : " · Reviewed by your care team"} ·{" "}
              {when(state.reviewedAt)}
            </MutedText>
            {state.reviewSummary && <Text style={{ fontSize: 13, color: colors.ink }}>{state.reviewSummary}</Text>}
            <Text
              onPress={() => void WebBrowser.openBrowserAsync(`${PLATFORM_URL}/api/patient/health-check/report`)}
              style={{ fontSize: 13, fontWeight: "700", color: colors.brand, marginTop: 4 }}
            >
              Download your Health Check report (PDF) →
            </Text>
          </>
        ) : (
          <MutedText>
            Once your checks are in, a doctor reviews everything and walks you through your results and plan
            on a video call.
          </MutedText>
        )}
      </Card>

      {state.videoConsult && <VideoConsultCard consult={state.videoConsult} onChanged={refresh} />}

      <CalloutCard
        icon="happy-outline"
        title="Mental wellbeing check-in"
        subtitle="A quick, private check-in (PHQ-9/GAD-7/AUDIT-C) — already native, in your Wellbeing section."
        ctaLabel="Go to Wellbeing"
        onPress={() => onNavigate("wellbeing")}
      />
    </ScrollView>
  );
}

function LipidProfileCard({ lipids }: { lipids: LipidProfile }) {
  return (
    <Card style={{ gap: 8 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Lipid profile</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {LIPID_ANALYTE_CODES.map((code) => {
          const meta = LIPID_ANALYTE_META[code];
          const reading = lipids.latest[code];
          return (
            <View key={code} style={{ flexBasis: "31%", flexGrow: 1, backgroundColor: colors.groupBg, borderRadius: radius.control, padding: 8 }}>
              <MutedText>
                {meta.short}
                {meta.computed ? " (computed)" : ""}
              </MutedText>
              <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>
                {reading ? `${reading.value} ` : "—"}
                {reading && <Text style={{ fontSize: 11, fontWeight: "400", color: colors.muted }}>{meta.unit}</Text>}
              </Text>
            </View>
          );
        })}
      </View>
      {lipids.latestDrawnAt && (
        <MutedText>
          Last drawn {when(lipids.latestDrawnAt)}. Non-HDL (Total − HDL) is the atherogenic-cholesterol summary
          your care team tracks against your overall cardiovascular risk.
        </MutedText>
      )}
    </Card>
  );
}

function RiskSignalsCard({ signals }: { signals: RiskSignal[] }) {
  const elevated = signals.filter((s) => RISK_LEVEL_COPY[s.riskLevel] != null);

  return (
    <Card style={{ gap: 8 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>What your care team is watching</Text>
      {elevated.length === 0 ? (
        <MutedText>
          Your recent readings and risk checks are within the normal range: nothing here needs extra attention
          right now.
        </MutedText>
      ) : (
        <>
          <MutedText>
            A plain-language look at what&apos;s shaping your care, not a diagnosis. If your care team reaches
            out, this is usually part of why.
          </MutedText>
          <View style={{ gap: 4 }}>
            {elevated.map((s) => (
              <Text key={s.scoreType} style={{ fontSize: 13, color: colors.ink }}>
                <Text style={{ fontWeight: "700" }}>{SCORE_TYPE_LABEL[s.scoreType] ?? s.scoreType.replace(/_/g, " ")}</Text>
                {": "}
                {RISK_LEVEL_COPY[s.riskLevel]}
              </Text>
            ))}
          </View>
        </>
      )}
      <MutedText>Last updated {when(signals[0].computedAt)}</MutedText>
    </Card>
  );
}

function VideoConsultCard({ consult, onChanged }: { consult: HealthCheckVideoConsult; onChanged: () => void }) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (consult.scheduledAt) {
    return (
      <Card style={{ gap: 8 }}>
        <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Your video consult</Text>
        <MutedText>Confirmed for {formatSlot(consult.scheduledAt)}.</MutedText>
        {consult.joinUrl && (
          <SecondaryButton
            title="Go to your video visit"
            onPress={() => void Linking.openURL(consult.joinUrl!).catch(() => {})}
          />
        )}
      </Card>
    );
  }

  if (!consult.proposedSlots || consult.proposedSlots.length === 0) return null;

  async function pick(slot: string) {
    setPending(slot);
    setError(null);
    const result = await confirmVideoSlot(consult.id, slot);
    setPending(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onChanged();
  }

  return (
    <Card style={{ gap: 8 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Pick a time for your video consult</Text>
      <MutedText>Your doctor is ready to walk you through your results. Pick whichever works for you.</MutedText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {consult.proposedSlots.map((slot) => (
          <Text
            key={slot}
            onPress={() => (pending ? null : pick(slot))}
            style={{
              fontSize: 12.5,
              fontWeight: "600",
              paddingVertical: 7,
              paddingHorizontal: 11,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: colors.border,
              color: colors.ink,
              opacity: pending ? 0.5 : 1,
            }}
          >
            {pending === slot ? "Confirming…" : formatSlot(slot)}
          </Text>
        ))}
      </View>
      {error && <ErrorText>{error}</ErrorText>}
    </Card>
  );
}
