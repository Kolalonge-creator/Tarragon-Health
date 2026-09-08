import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { koboToNaira } from "@tarragon/shared";
import {
  RECOMMENDED_SCREEN_LABEL,
  STI_CONDOM_USES,
  STI_CONDOM_USE_LABEL,
  STI_PARTNER_COUNTS,
  STI_PARTNER_COUNT_LABEL,
  STI_SYMPTOMS,
  STI_SYMPTOM_LABEL,
  bookStiTest,
  loadOpenStiCaseEpisodes,
  loadPartnerNotifications,
  loadStiBookableBundles,
  requestSelfNotifyPartnerCopy,
  submitClinicianAssistedPartnerNotification,
  submitStiRiskCheck,
  type PartnerCopyTemplates,
  type StiCaseEpisode,
  type StiCaseStatus,
  type StiCondomUse,
  type StiPartnerCount,
  type StiRiskCheckResult,
  type StiSymptom,
} from "@/lib/sti";
import type { PanelBundle } from "@/lib/labs";
import { colors, radius } from "@/ui/theme";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/components";

/** `tarragonhealth://lab-order-callback` — the deep link Paystack's hosted
 * checkout redirects back to. Same mechanism as "My services"'s
 * postServicesCheckout: expo-web-browser's openAuthSessionAsync recognises
 * any navigation to this URL as "finished" and hands control back to the
 * app; it is never a screen of its own. */
const LAB_ORDER_CHECKOUT_CALLBACK_URL = "tarragonhealth://lab-order-callback";

function when(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
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

/**
 * Native equivalent of sti-testing-panel.tsx: a real catalogue list + "Book
 * & pay" buttons. The catalogue read and the lab_orders insert are both
 * plain native calls; only the actual Paystack charge hands off to the
 * system browser (expo-web-browser's openAuthSessionAsync, same pattern as
 * "My services"/Appointments' pay-to-confirm) since a card-entry page has
 * to be Paystack's own hosted checkout, never ours, on web either.
 */
function StiBookingPanel() {
  const [loading, setLoading] = useState(true);
  const [bundles, setBundles] = useState<PanelBundle[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [bookError, setBookError] = useState<string | null>(null);
  const [bookMessage, setBookMessage] = useState<string | null>(null);

  useEffect(() => {
    loadStiBookableBundles()
      .then(setBundles)
      .catch(() => setLoadError("Could not load the testing catalogue."))
      .finally(() => setLoading(false));
  }, []);

  async function book(bundle: PanelBundle) {
    setBookError(null);
    setBookMessage(null);
    setBookingId(bundle.id);
    try {
      const result = await bookStiTest(bundle.id, LAB_ORDER_CHECKOUT_CALLBACK_URL);
      if (!result.ok) {
        setBookError(result.error);
        return;
      }
      await WebBrowser.openAuthSessionAsync(result.data, LAB_ORDER_CHECKOUT_CALLBACK_URL);
      setBookMessage("We're confirming your payment. If it succeeded, your order will show up shortly.");
    } finally {
      setBookingId(null);
    }
  }

  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>STI testing</Text>
      <MutedText>
        Test on your own schedule, whether or not you did the check-in above. Results are reviewed by a
        doctor either way.
      </MutedText>

      {loading && <ActivityIndicator color={colors.brand} />}
      {loadError && <ErrorText>{loadError}</ErrorText>}
      {!loading && !loadError && bundles.length === 0 && <MutedText>No STI tests are available to book yet.</MutedText>}

      {bundles.map((bundle) => (
        <View
          key={bundle.id}
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingVertical: 6 }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 13.5, fontWeight: "600", color: colors.ink }}>{bundle.name}</Text>
            {bundle.description && <MutedText>{bundle.description}</MutedText>}
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink, marginTop: 2 }}>
              ₦{koboToNaira(bundle.price_kobo).toLocaleString("en-NG")}
            </Text>
          </View>
          <SecondaryButton title="Book & pay" onPress={() => void book(bundle)} loading={bookingId === bundle.id} disabled={bookingId !== null} />
        </View>
      ))}

      {bookError && <ErrorText>{bookError}</ErrorText>}
      {bookMessage && <MutedText>{bookMessage}</MutedText>}

      <MutedText>Home test kits aren&apos;t available from a partner yet. For now, book above and we&apos;ll arrange the sample collection.</MutedText>
    </Card>
  );
}

/**
 * "Risk check & testing" tab — the check-in form plus a real native
 * catalogue + booking panel (StiBookingPanel), stacked exactly like
 * sexual-health-hub.tsx's "testing" tab (StiRiskCheckForm + StiTestingPanel
 * always both visible, not gated behind the check-in result).
 */
export function SexualHealthTestingTab() {
  const [active, setActive] = useState(false);
  const [newPartner, setNewPartner] = useState(false);
  const [partnerCount, setPartnerCount] = useState<StiPartnerCount | undefined>();
  const [condomUse, setCondomUse] = useState<StiCondomUse | undefined>();
  const [symptoms, setSymptoms] = useState<StiSymptom[]>([]);
  const [priorDiagnosis, setPriorDiagnosis] = useState(false);
  const [partnerDiagnosed, setPartnerDiagnosed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StiRiskCheckResult | null>(null);

  function toggleSymptom(value: StiSymptom) {
    setSymptoms((prev) => {
      if (value === "none") return prev.includes("none") ? [] : ["none"];
      const withoutNone = prev.filter((s) => s !== "none");
      return withoutNone.includes(value) ? withoutNone.filter((s) => s !== value) : [...withoutNone, value];
    });
  }

  async function submit() {
    setError(null);
    setSubmitting(true);
    const submitResult = await submitStiRiskCheck({
      sexually_active_12mo: active,
      new_partner_3mo: newPartner,
      partner_count_12mo: partnerCount,
      condom_use: condomUse,
      symptoms,
      prior_sti_diagnosis: priorDiagnosis,
      partner_diagnosed_sti: partnerDiagnosed,
    });
    setSubmitting(false);
    if (!submitResult.ok) {
      setError(submitResult.error);
      return;
    }
    setResult(submitResult.data);
  }

  if (result) {
    return (
      <View style={{ gap: 12 }}>
        <Card style={{ gap: 10 }}>
          <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Thanks for checking in</Text>
          {result.recommendedScreenCodes.length > 0 ? (
            <>
              <MutedText>Based on your answers, it&apos;s worth getting these tests done:</MutedText>
              {result.recommendedScreenCodes.map((code) => (
                <Text key={code} style={{ fontSize: 13, color: colors.ink }}>
                  • {RECOMMENDED_SCREEN_LABEL[code] ?? code.replace(/_/g, " ")}
                </Text>
              ))}
              <MutedText>
                This isn&apos;t a diagnosis, just a nudge based on what you told us. Testing is quick,
                confidential, and a doctor reviews every result.
              </MutedText>
            </>
          ) : (
            <MutedText>
              Nothing here points to needing a test right now. If anything changes (a new partner, a new
              symptom, anything at all), you can always come back and check again.
            </MutedText>
          )}
        </Card>
        <StiBookingPanel />
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <Card style={{ gap: 10 }}>
        <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Sexual health check-in</Text>
        <MutedText>
          A few quick, private questions to help us suggest which tests, if any, are worth getting. This
          stays between you and your care team.
        </MutedText>

        <Text onPress={() => setActive((v) => !v)} style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>
          <Text style={{ fontWeight: "700", color: active ? colors.brand : colors.faint }}>{active ? "☑ " : "☐ "}</Text>
          I&apos;ve been sexually active in the last 12 months
        </Text>

        {active && (
          <View style={{ gap: 10, borderLeftWidth: 2, borderLeftColor: colors.brandTint, paddingLeft: 12 }}>
            <Text onPress={() => setNewPartner((v) => !v)} style={{ fontSize: 13, color: colors.ink }}>
              <Text style={{ fontWeight: "700", color: newPartner ? colors.brand : colors.faint }}>{newPartner ? "☑ " : "☐ "}</Text>
              I&apos;ve had a new partner in the last 3 months
            </Text>

            <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>Roughly how many partners in the last 12 months?</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {STI_PARTNER_COUNTS.map((v) => (
                <Chip key={v} label={STI_PARTNER_COUNT_LABEL[v]} active={partnerCount === v} onPress={() => setPartnerCount(v)} />
              ))}
            </View>

            <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>How often do you use condoms?</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {STI_CONDOM_USES.map((v) => (
                <Chip key={v} label={STI_CONDOM_USE_LABEL[v]} active={condomUse === v} onPress={() => setCondomUse(v)} />
              ))}
            </View>

            <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>Have you noticed any of these recently?</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {STI_SYMPTOMS.map((v) => (
                <Chip key={v} label={STI_SYMPTOM_LABEL[v]} active={symptoms.includes(v)} onPress={() => toggleSymptom(v)} />
              ))}
            </View>

            <Text onPress={() => setPriorDiagnosis((v) => !v)} style={{ fontSize: 13, color: colors.ink }}>
              <Text style={{ fontWeight: "700", color: priorDiagnosis ? colors.brand : colors.faint }}>{priorDiagnosis ? "☑ " : "☐ "}</Text>
              I&apos;ve been diagnosed with an STI before
            </Text>
            <Text onPress={() => setPartnerDiagnosed((v) => !v)} style={{ fontSize: 13, color: colors.ink }}>
              <Text style={{ fontWeight: "700", color: partnerDiagnosed ? colors.brand : colors.faint }}>{partnerDiagnosed ? "☑ " : "☐ "}</Text>
              A partner has told me they were diagnosed with an STI
            </Text>
          </View>
        )}

        {error && <ErrorText>{error}</ErrorText>}
        <PrimaryButton title="See what's worth checking" onPress={submit} loading={submitting} />
      </Card>
      <StiBookingPanel />
    </View>
  );
}

const STAGE_ORDER: StiCaseStatus[] = ["result_received", "clinical_review", "patient_notified", "treatment_in_progress", "treatment_completed"];
const STAGE_LABELS = ["Result received", "Clinical review", "Doctor has been in touch", "Treatment", "Follow-up"];
const STI_CODE_LABEL: { [code: string]: string } = { chlamydia_gonorrhoea: "Chlamydia & Gonorrhoea", syphilis: "Syphilis" };
const PARTNER_NOTIFY_ELIGIBLE_STATUSES: StiCaseStatus[] = ["patient_notified", "treatment_in_progress", "treatment_completed"];

function StageTracker({ status }: { status: StiCaseStatus }) {
  const found = STAGE_ORDER.indexOf(status);
  const currentIndex = found === -1 ? STAGE_ORDER.length - 1 : found;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {STAGE_LABELS.map((label, i) => {
        const state = i < currentIndex ? "complete" : i === currentIndex ? "current" : "upcoming";
        return (
          <View
            key={label}
            style={{
              paddingVertical: 5,
              paddingHorizontal: 9,
              borderRadius: 999,
              backgroundColor: state === "upcoming" ? colors.groupBg : state === "current" ? colors.brand : colors.brandTint,
            }}
          >
            <Text style={{ fontSize: 11, fontWeight: "600", color: state === "current" ? "#FFFFFF" : state === "complete" ? colors.brandPressed : colors.muted }}>
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function PartnerNotifyFlow({ episode, patientId, organisationId }: { episode: StiCaseEpisode; patientId: string; organisationId: string }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"choose" | "self_notify" | "clinician_assisted" | "done">("choose");
  const [templates, setTemplates] = useState<PartnerCopyTemplates | null>(null);
  const [partnerLabel, setPartnerLabel] = useState("");
  const [partnerContact, setPartnerContact] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasHistory, setHasHistory] = useState(false);

  useEffect(() => {
    loadPartnerNotifications(episode.id)
      .then((rows) => setHasHistory(rows.length > 0))
      .catch(() => {});
  }, [episode.id]);

  async function chooseSelfNotify() {
    setError(null);
    setPending(true);
    const result = await requestSelfNotifyPartnerCopy(patientId, organisationId, episode.id);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setTemplates(result.data);
    setMode("self_notify");
  }

  async function submitClinicianAssisted() {
    setError(null);
    setPending(true);
    const result = await submitClinicianAssistedPartnerNotification(patientId, organisationId, episode.id, partnerLabel || null, partnerContact);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMode("done");
  }

  if (!open) {
    return (
      <View style={{ gap: 4 }}>
        {hasHistory && (
          <MutedText>
            You&apos;ve already looked into this for this result. You&apos;re welcome to do it again, or
            not, entirely up to you.
          </MutedText>
        )}
        <SecondaryButton title="Let a partner know" onPress={() => setOpen(true)} />
      </View>
    );
  }

  return (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 12, gap: 10 }}>
      <MutedText>
        Totally optional, and entirely your call. A partner might want to get tested too, but there&apos;s
        no pressure either way.
      </MutedText>

      {mode === "choose" && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <PrimaryButton title="I'll let them know myself" onPress={chooseSelfNotify} loading={pending} />
          <SecondaryButton title="Ask my care team to help" onPress={() => setMode("clinician_assisted")} />
          <SecondaryButton title="Not now" onPress={() => setOpen(false)} />
        </View>
      )}

      {mode === "self_notify" && templates && (
        <View style={{ gap: 10 }}>
          <MutedText>
            Copy whichever fits how you&apos;d usually message them. It doesn&apos;t mention you, your
            result, or Tarragon.
          </MutedText>
          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 11, fontWeight: "700", textTransform: "uppercase", color: colors.muted }}>Text message</Text>
            <Text selectable style={{ fontSize: 13, color: colors.ink, backgroundColor: colors.groupBg, borderRadius: radius.control, padding: 10 }}>
              {templates.smsTemplate}
            </Text>
          </View>
          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 11, fontWeight: "700", textTransform: "uppercase", color: colors.muted }}>WhatsApp / longer message</Text>
            <Text selectable style={{ fontSize: 13, color: colors.ink, backgroundColor: colors.groupBg, borderRadius: radius.control, padding: 10 }}>
              {templates.whatsappTemplate}
            </Text>
          </View>
          <SecondaryButton title="Done" onPress={() => setOpen(false)} />
        </View>
      )}

      {mode === "clinician_assisted" && (
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>What should we call them? (optional)</Text>
          <TextInput value={partnerLabel} onChangeText={setPartnerLabel} placeholder="e.g. my partner" style={textInputStyle} />
          <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>Their phone number or contact detail</Text>
          <TextInput value={partnerContact} onChangeText={setPartnerContact} placeholder="+234…" style={textInputStyle} />
          {error && <ErrorText>{error}</ErrorText>}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <PrimaryButton title="Send to my care team" onPress={submitClinicianAssisted} disabled={!partnerContact} loading={pending} />
            <SecondaryButton title="Back" onPress={() => setMode("choose")} />
          </View>
        </View>
      )}

      {mode === "done" && (
        <View style={{ gap: 8 }}>
          <MutedText>Thanks. Your care team has what they need and will take it from here.</MutedText>
          <SecondaryButton title="Close" onPress={() => setOpen(false)} />
        </View>
      )}
      {error && mode !== "clinician_assisted" && <ErrorText>{error}</ErrorText>}
    </View>
  );
}

/**
 * "My results & care" tab — one card per open curable-STI case episode
 * (result received through treatment/follow-up), plus the optional
 * partner-notification flow. Confidential by construction: RLS on
 * sti_case_episodes is patient-self or org staff only, never a
 * sponsor/supporter.
 */
export function SexualHealthResultsTab({ patientId, organisationId }: { patientId: string; organisationId: string }) {
  const [episodes, setEpisodes] = useState<StiCaseEpisode[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    loadOpenStiCaseEpisodes(patientId)
      .then(setEpisodes)
      .catch(() => {});
  }, [patientId]);

  useEffect(() => {
    refresh();
    setLoading(false);
  }, [refresh]);

  return (
    <View style={{ gap: 12 }}>
      <MutedText>
        If a chlamydia, gonorrhoea, or syphilis result needs follow-up, it shows up here automatically.
        Nothing to do here unless you have an open case.
      </MutedText>
      {!loading && episodes.length === 0 && <MutedText>Nothing open right now.</MutedText>}
      {episodes.map((episode) => {
        const showConfidentialNotice = episode.status === "result_received" || episode.status === "clinical_review";
        const canNotifyPartner = PARTNER_NOTIFY_ELIGIBLE_STATUSES.includes(episode.status);
        return (
          <Card key={episode.id} style={{ gap: 10 }}>
            <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>
              {STI_CODE_LABEL[episode.sti_code] ?? episode.sti_code.replace(/_/g, " ")}
            </Text>
            <MutedText>Started {when(episode.created_at)}</MutedText>
            <StageTracker status={episode.status} />
            {showConfidentialNotice ? (
              <MutedText>
                This result is confidential — visible only to you and your care team, never sent over
                WhatsApp, SMS, or email.
              </MutedText>
            ) : (
              <MutedText>
                Your care team has been in touch about this directly. Anything from here (treatment,
                follow-up) is between you and them.
              </MutedText>
            )}
            {canNotifyPartner && <PartnerNotifyFlow episode={episode} patientId={patientId} organisationId={organisationId} />}
          </Card>
        );
      })}
    </View>
  );
}
