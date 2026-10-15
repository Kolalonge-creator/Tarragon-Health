import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as WebBrowser from "expo-web-browser";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import {
  catalogueLabel,
  checkMedicineOnAdd,
  parseScheduleSpec,
  prefillFromCatalogue,
  searchCatalogue,
  validatePillCount,
  type AddCheckFinding,
  type CatalogueEntry,
  type FoodNote,
  type ScheduleSpec,
} from "@tarragon/medicines";
import { addSideEffectNote, loadInteractionCheckState, loadMedicineCatalogue } from "@/lib/medicine-catalogue";
import { useUiLanguage } from "@/lib/ui-language";
import {
  addMedication,
  loadSupplies,
  saveSupply,
  type SupplyView,
  checkPackAgainstPrescription,
  checkinQuestion,
  getPrescriptionPdfUrl,
  loadDueCheckins,
  loadLabMonitoring,
  loadMedicationCabinet,
  loadMedicationCollections,
  loadRepeatRequests,
  logMedicationCollection,
  NAFDAC_MAS,
  requestMedicationRepeat,
  respondToCheckin,
  todayIsoDate,
  type AdherenceCheckinItem,
  type LabMonitoringItem,
  type MedicationCabinetItem,
  type MedicationCollectionItem,
  type PackCheckResult,
  type RepeatRequestItem,
} from "@/lib/medications";
import { radius, spacing } from "@/ui/theme";
import { useLegacyColors, useTheme } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton, SectionLabel } from "@/ui/legacy-kit";
import { PharmacyOrdersSection } from "@/screens/sections/pharmacy-orders-section";

interface MedicineCabinetScreenProps {
  patientId: string;
  organisationId: string;
}

const inputStyle = (colors: ReturnType<typeof useLegacyColors>) =>
  ({
    height: 40,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.control,
    paddingHorizontal: 12,
    fontSize: 14,
    color: colors.ink,
    backgroundColor: colors.card,
  }) as const;

const SOURCE_LABEL: Record<string, string> = {
  clinician: "Prescribed",
  specialist: "Specialist",
  patient: "Self-added",
  fhir_import: "Imported",
};

/** "5 days left" / "due today" / "3 days overdue" — mirrors medications-list.tsx's daysLeftLabel. */
function daysLeftLabel(dateStr: string): string {
  const today = new Date(new Date().toDateString());
  const target = new Date(new Date(dateStr).toDateString());
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (days > 0) return `${days} day${days === 1 ? "" : "s"} left`;
  if (days === 0) return "due today";
  return `${-days} day${days === -1 ? "" : "s"} overdue`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function Pill({ tone, children }: { tone: "green" | "amber" | "grey" | "red"; children: string }) {
  const colors = useLegacyColors();
  const styles: Record<string, { bg: string; text: string }> = {
    green: { bg: colors.brandTint, text: colors.brandPressed },
    amber: { bg: colors.status.warnBg, text: colors.status.warn },
    grey: { bg: colors.pressed, text: colors.muted },
    red: { bg: colors.dangerBg, text: colors.danger },
  };
  const s = styles[tone];
  return (
    <View style={{ backgroundColor: s.bg, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9 }}>
      <Text style={{ fontSize: 11, fontWeight: "700", color: s.text }}>{children}</Text>
    </View>
  );
}

/**
 * Native replacement for the "Your medicines cabinet" WebView modal
 * (previously <WebViewScreen path="/patient/medications" />). Covers the
 * real feature set read from apps/web's patient medications page: the full
 * active-medication list, self-add, adherence check-in history, lab
 * monitoring due dates, and refill (next-supply request + "I picked this
 * up" collection recording — Tarragon has no pharmacy routing to track a
 * delivery status for, see logMedicationCollection's header comment).
 *
 * Deliberately NOT ported from the web page, as out-of-scope simplifications
 * for this native pass: stop-medication, side-effect/access-barrier
 * reporting, prescription amendment, and past (stopped) medications
 * history. The paid prescription-renewal purchase flow (see
 * pharmacy-orders-section.tsx, rendered below) is now built: a patient can
 * see every pharmacy_orders row on file and pay a pending one by card
 * via the system browser — what's
 * still web-only is order CREATION from the pharmacy catalogue, because
 * every pharmacy_partners row is is_active=false platform-wide today (see
 * lib/prescription-renewal.ts's module comment). "Check my pack" keeps
 * the photo step for the patient's own reference but compares a typed
 * reading instead of an AI OCR read — see checkPackAgainstPrescription's
 * header comment in lib/medications.ts for why.
 */
export function MedicineCabinetScreen({ patientId, organisationId }: MedicineCabinetScreenProps) {
  const colors = useLegacyColors();
  const [medications, setMedications] = useState<MedicationCabinetItem[]>([]);
  const [medsLoading, setMedsLoading] = useState(true);
  const [medsError, setMedsError] = useState(false);

  const [collections, setCollections] = useState<MedicationCollectionItem[]>([]);
  const [requests, setRequests] = useState<RepeatRequestItem[]>([]);
  const [checkins, setCheckins] = useState<AdherenceCheckinItem[]>([]);
  const [checkinsError, setCheckinsError] = useState(false);
  const [labMonitoring, setLabMonitoring] = useState<LabMonitoringItem[]>([]);
  const [labMonitoringError, setLabMonitoringError] = useState(false);
  const [supplies, setSupplies] = useState<Map<string, SupplyView>>(new Map());

  const load = useCallback(async () => {
    const [medsRes, collectionsRes, requestsRes, checkinsRes, labRes] = await Promise.all([
      loadMedicationCabinet(patientId),
      loadMedicationCollections(patientId),
      loadRepeatRequests(patientId),
      loadDueCheckins(patientId),
      loadLabMonitoring(patientId),
    ]);

    if (medsRes.ok) {
      setMedsError(false);
      setMedications(medsRes.data);
      const supplyRes = await loadSupplies(patientId, medsRes.data);
      if (supplyRes.ok) setSupplies(supplyRes.data);
    } else {
      setMedsError(true);
    }
    if (collectionsRes.ok) setCollections(collectionsRes.data);
    if (requestsRes.ok) setRequests(requestsRes.data);
    setCheckinsError(!checkinsRes.ok);
    if (checkinsRes.ok) setCheckins(checkinsRes.data);
    setLabMonitoringError(!labRes.ok);
    if (labRes.ok) setLabMonitoring(labRes.data);
  }, [patientId]);

  useEffect(() => {
    load()
      .catch(() => setMedsError(true))
      .finally(() => setMedsLoading(false));
  }, [load]);

  function retryLoad() {
    setMedsLoading(true);
    load()
      .catch(() => setMedsError(true))
      .finally(() => setMedsLoading(false));
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 18 }}>
      <View>
        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.ink }}>Your medicines cabinet</Text>
        <MutedText>Everything you&apos;re taking, refills, check-ins, and pack checks.</MutedText>
      </View>

      <View style={{ gap: 10 }}>
        <SectionLabel>Active medications</SectionLabel>
        {medsLoading ? (
          <ActivityIndicator color={colors.brand} />
        ) : medsError ? (
          <Pressable accessibilityRole="button" accessibilityLabel="We couldn't load your medications. Tap to retry." onPress={retryLoad}>
            <Card style={{ alignItems: "center", gap: 8 }}>
              <Ionicons name="cloud-offline-outline" size={22} color={colors.faint} />
              <Text style={{ fontSize: 14, fontWeight: "600", color: colors.ink }}>We couldn&apos;t load this right now</Text>
              <MutedText>Tap to retry.</MutedText>
            </Card>
          </Pressable>
        ) : medications.length === 0 ? (
          <Card>
            <MutedText>No active medications on file.</MutedText>
          </Card>
        ) : (
          <View style={{ gap: 10 }}>
            {medications.map((medication) => (
              <MedicationCard
                key={medication.id}
                medication={medication}
                patientId={patientId}
                organisationId={organisationId}
                supply={supplies.get(medication.id) ?? null}
                latestCollection={collections.find((c) => c.medication_id === medication.id) ?? null}
                latestRequest={
                  requests
                    .filter((r) => r.medication_id === medication.id)
                    .sort((a, b) => (a.requested_at < b.requested_at ? 1 : -1))[0] ?? null
                }
                onChanged={load}
              />
            ))}
          </View>
        )}
      </View>

      <PharmacyOrdersSection patientId={patientId} />

      <AddMedicationSection patientId={patientId} existing={medications} onAdded={load} />

      {checkinsError || checkins.length > 0 ? (
        <View style={{ gap: 10 }}>
          <SectionLabel>Medication check-in</SectionLabel>
          {checkinsError ? (
            <Card>
              <ErrorText>Could not load your check-ins.</ErrorText>
            </Card>
          ) : (
            <View style={{ gap: 8 }}>
              {checkins.map((checkin) => (
                <CheckinCard key={checkin.id} checkin={checkin} onAnswered={load} />
              ))}
            </View>
          )}
        </View>
      ) : null}

      <CheckMyPackSection medications={medications} />

      {labMonitoringError || labMonitoring.length > 0 ? (
        <View style={{ gap: 10 }}>
          <SectionLabel>Lab monitoring</SectionLabel>
          {labMonitoringError ? (
            <Card>
              <ErrorText>Could not load lab monitoring.</ErrorText>
            </Card>
          ) : (
            <Card style={{ gap: 0, padding: 0 }}>
              {labMonitoring.map((item, i) => (
                <LabMonitoringRow key={item.id} item={item} isFirst={i === 0} />
              ))}
            </Card>
          )}
        </View>
      ) : null}
    </ScrollView>
  );
}

// --- Active medication card --------------------------------------------------

function MedicationCard({
  medication,
  patientId,
  organisationId,
  supply,
  latestCollection,
  latestRequest,
  onChanged,
}: {
  medication: MedicationCabinetItem;
  patientId: string;
  organisationId: string;
  supply: SupplyView | null;
  latestCollection: MedicationCollectionItem | null;
  latestRequest: RepeatRequestItem | null;
  onChanged: () => Promise<void>;
}) {
  const { scheme } = useTheme();
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const tr = (key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params);
  const [collectOpen, setCollectOpen] = useState(false);
  const [collectedOn, setCollectedOn] = useState(todayIsoDate());
  const [pharmacyName, setPharmacyName] = useState("");
  const [collectPending, setCollectPending] = useState(false);
  const [collectError, setCollectError] = useState<string | null>(null);

  const [requestPending, setRequestPending] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  const scheduleTimes = Array.isArray(medication.schedule_times) ? (medication.schedule_times as string[]) : [];

  async function submitCollection() {
    setCollectPending(true);
    setCollectError(null);
    const result = await logMedicationCollection(
      patientId,
      organisationId,
      medication.id,
      medication.drug_name,
      collectedOn,
      pharmacyName
    );
    setCollectPending(false);
    if (result.error) {
      setCollectError(result.error);
      return;
    }
    setCollectOpen(false);
    setPharmacyName("");
    await onChanged();
  }

  async function submitRepeatRequest() {
    setRequestPending(true);
    setRequestError(null);
    const result = await requestMedicationRepeat(patientId, medication.id);
    setRequestPending(false);
    if (result.error) {
      setRequestError(result.error);
      return;
    }
    await onChanged();
  }

  return (
    <Card style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
        <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>{medication.drug_name}</Text>
        <Pill tone={medication.source === "clinician" ? "green" : medication.source === "specialist" ? "amber" : "grey"}>
          {SOURCE_LABEL[medication.source] ?? "Self-added"}
        </Pill>
        {medication.care_plan_condition ? <Pill tone="grey">{formatCondition(medication.care_plan_condition)}</Pill> : null}
      </View>
      <MutedText>{[medication.dose, medication.frequency].filter(Boolean).join(", ") || "No dose/frequency set"}</MutedText>
      {medication.source === "clinician" ? <MutedText>{tr("meds.dose_locked")}</MutedText> : null}
      {scheduleTimes.length > 0 ? <MutedText>Doses: {scheduleTimes.join(", ")}</MutedText> : null}
      {medication.source === "specialist" && medication.prescriber_name ? (
        <MutedText>Started by {medication.prescriber_name}</MutedText>
      ) : null}
      {medication.refill_date ? (
        <MutedText>
          Refill by {formatDate(medication.refill_date)} · {daysLeftLabel(medication.refill_date)}
        </MutedText>
      ) : null}
      {medication.last_confirmed_at ? (
        <MutedText>Refill checked and still valid · {formatDate(medication.last_confirmed_at)}</MutedText>
      ) : null}
      {medication.expires_at ? (
        <MutedText>
          {new Date(medication.expires_at).getTime() < Date.now() ? "Expired" : "Valid until"} {formatDate(medication.expires_at)}
        </MutedText>
      ) : null}
      {medication.source === "clinician" && medication.rx_number && medication.verification_code && !medication.superseded_at ? (
        <View style={{ gap: 4, marginTop: 4 }}>
          <MutedText>
            Rx number {medication.rx_number} · Code {medication.verification_code}
          </MutedText>
          <MutedText>
            This is not a controlled medicine. TarragonHealth does not prescribe controlled medicines.
          </MutedText>
        </View>
      ) : null}
      <SupplySection medication={medication} patientId={patientId} organisationId={organisationId} supply={supply} onSaved={onChanged} />
      {latestCollection ? (
        <MutedText>
          Last picked up {formatDate(latestCollection.dispensed_on)}
          {latestCollection.pharmacy_name ? ` · ${latestCollection.pharmacy_name}` : ""}
        </MutedText>
      ) : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
        {!collectOpen ? (
          <SmallGhostButton title="I picked this up" onPress={() => setCollectOpen(true)} />
        ) : null}
        {medication.source === "clinician" &&
        medication.rx_number &&
        !medication.superseded_at &&
        !(medication.expires_at && new Date(medication.expires_at).getTime() < Date.now()) ? (
          <SmallGhostButton
            title="Prescription (PDF)"
            onPress={async () => {
              const result = await getPrescriptionPdfUrl(medication.id);
              if (result.ok) void WebBrowser.openBrowserAsync(result.data);
              else setRequestError(result.error);
            }}
          />
        ) : null}
        {medication.source === "clinician" && medication.repeats_allowed > 0 ? (
          latestRequest?.status === "pending" ? (
            <MutedText>Next supply requested {formatDate(latestRequest.requested_at)} · awaiting review</MutedText>
          ) : (
            <SmallGhostButton
              title={requestPending ? "Requesting…" : "Request next supply"}
              onPress={submitRepeatRequest}
              disabled={requestPending}
            />
          )
        ) : null}
      </View>

      {latestRequest?.status === "approved" ? (
        <MutedText>Approved {formatDate(latestRequest.reviewed_at ?? latestRequest.requested_at)}. You can collect your next supply.</MutedText>
      ) : null}
      {latestRequest?.status === "denied" ? (
        <ErrorText>Request declined{latestRequest.denial_reason ? `: ${latestRequest.denial_reason}` : ""}</ErrorText>
      ) : null}
      {requestError ? <ErrorText>{requestError}</ErrorText> : null}

      <SideEffectNoteSection medicationId={medication.id} />

      {collectOpen ? (
        <View style={{ gap: 8, marginTop: 6, backgroundColor: colors.groupBg, borderRadius: radius.control, padding: 10 }}>
          <View>
            <MutedText>Date collected (YYYY-MM-DD)</MutedText>
            <TextInput keyboardAppearance={scheme} value={collectedOn} onChangeText={setCollectedOn} style={inputStyle(colors)} placeholder="YYYY-MM-DD" placeholderTextColor={colors.subtle} />
          </View>
          <View>
            <MutedText>Pharmacy (optional)</MutedText>
            <TextInput keyboardAppearance={scheme}
              value={pharmacyName}
              onChangeText={setPharmacyName}
              style={inputStyle(colors)}
              placeholder="e.g. HealthPlus"
              placeholderTextColor={colors.subtle}
            />
          </View>
          <MutedText>{`${tr("medicines.mas.collect_prompt")} ${tr("medicines.mas.caveat")}`}</MutedText>
          {collectError ? <ErrorText>{collectError}</ErrorText> : null}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <PrimaryButton title={collectPending ? "Saving…" : "Confirm"} onPress={submitCollection} disabled={collectPending} />
            </View>
            <View style={{ flex: 1 }}>
              <SecondaryButton title="Cancel" onPress={() => setCollectOpen(false)} disabled={collectPending} />
            </View>
          </View>
        </View>
      ) : null}
    </Card>
  );
}

type ScheduleKind = "daily" | "every_n_days" | "weekdays" | "as_needed" | "taper";
const SCHEDULE_KINDS: ScheduleKind[] = ["daily", "every_n_days", "weekdays", "as_needed", "taper"];
const WINDOW_CHOICES = [0, 60, 120, 240] as const;
const FOOD_NOTES: FoodNote[] = ["with_food", "before_food", "after_food", "empty_stomach", "bedtime"];
interface TaperDraft {
  days: string;
  times: string;
  doseText: string;
}

/**
 * Pill count and refill countdown for one medicine. The patient types what is on
 * hand; the estimate walks the schedule forward and says how long it lasts. The
 * count is the patient's own record, separate from the prescription, so changing it
 * never touches a prescribed dose (INV-02).
 */
function SupplySection({
  medication,
  patientId,
  organisationId,
  supply,
  onSaved,
}: {
  medication: MedicationCabinetItem;
  patientId: string;
  organisationId: string;
  supply: SupplyView | null;
  onSaved: () => Promise<void>;
}) {
  const { scheme } = useTheme();
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const tr = (key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params);
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(supply ? String(supply.pillsOnHand) : "");
  const [perDose, setPerDose] = useState(supply ? String(supply.pillsPerDose) : "1");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save() {
    const onHand = validatePillCount(Number(count));
    const per = validatePillCount(Number(perDose));
    if (!onHand.ok || !per.ok || per.value === 0) {
      setMessage(tr("meds.supply.invalid"));
      return;
    }
    setPending(true);
    const result = await saveSupply(patientId, organisationId, medication.id, onHand.value, per.value);
    setPending(false);
    if (result.error) {
      setMessage(tr("meds.supply.save_failed"));
      return;
    }
    setMessage(tr("meds.supply.saved"));
    setOpen(false);
    await onSaved();
  }

  const est = supply?.estimate;
  return (
    <View style={{ gap: 6, marginTop: 4 }}>
      {supply && est ? (
        <MutedText>
          {est.daysLeft !== null
            ? tr("meds.supply.days_left", { days: est.daysLeft })
            : est.coversCourse
              ? tr("meds.supply.covers_course")
              : `${tr("meds.supply.title")}: ${supply.pillsOnHand}`}
          {supply.low ? ` ${tr("meds.supply.low")}` : ""}
        </MutedText>
      ) : (
        <MutedText>{tr("meds.supply.unknown")}</MutedText>
      )}
      {message ? <MutedText>{message}</MutedText> : null}
      {!open ? <SmallGhostButton title={tr("meds.supply.title")} onPress={() => setOpen(true)} /> : null}
      {open ? (
        <View style={{ gap: 6 }}>
          <MutedText>{tr("meds.supply.count_label")}</MutedText>
          <TextInput keyboardAppearance={scheme} value={count} onChangeText={setCount} keyboardType="decimal-pad" style={inputStyle(colors)} placeholderTextColor={colors.subtle} />
          <MutedText>{tr("meds.supply.per_dose_label")}</MutedText>
          <TextInput keyboardAppearance={scheme} value={perDose} onChangeText={setPerDose} keyboardType="decimal-pad" style={inputStyle(colors)} placeholderTextColor={colors.subtle} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <PrimaryButton title={tr("meds.supply.save")} onPress={save} disabled={pending} />
            </View>
            <View style={{ flex: 1 }}>
              <SecondaryButton title="Cancel" onPress={() => setOpen(false)} disabled={pending} />
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function SmallGhostButton({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) {
  const colors = useLegacyColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({ opacity: disabled ? 0.5 : pressed ? 0.6 : 1, paddingVertical: 6 })}
    >
      <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.brandPressed }}>{title}</Text>
    </Pressable>
  );
}

function formatCondition(condition: string): string {
  return condition
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// --- Add medication -----------------------------------------------------------

const DOSE_TIME_PRESETS: { label: string; time: string }[] = [
  { label: "Morning", time: "08:00" },
  { label: "Afternoon", time: "13:00" },
  { label: "Evening", time: "20:00" },
];

function AddMedicationSection({ patientId, existing, onAdded }: { patientId: string; existing: MedicationCabinetItem[]; onAdded: () => Promise<void> }) {
  const { scheme } = useTheme();
  const colors = useLegacyColors();
  const [open, setOpen] = useState(false);
  const [drugName, setDrugName] = useState("");
  const [dose, setDose] = useState("");
  const [frequency, setFrequency] = useState("");
  const [refillDate, setRefillDate] = useState("");
  const [scheduleTimes, setScheduleTimes] = useState<string[]>([]);
  const [newTime, setNewTime] = useState("");
  const [startedBySpecialist, setStartedBySpecialist] = useState(false);
  const [prescriberName, setPrescriberName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const locale = asLocale(useUiLanguage());
  const tr = (key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params);
  // S53: catalogue suggestions (8.2) and the interaction and duplication check (8.7, behind its go-live guard).
  const [catalogue, setCatalogue] = useState<CatalogueEntry[]>([]);
  const [findings, setFindings] = useState<AddCheckFinding[] | null>(null);
  const [checkSkipped, setCheckSkipped] = useState(false);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void loadMedicineCatalogue().then((rows) => {
      if (alive) setCatalogue(rows);
    });
    return () => {
      alive = false;
    };
  }, [open]);
  const [pickedName, setPickedName] = useState<string | null>(null);
  const suggestions = searchCatalogue(catalogue, drugName === pickedName ? "" : drugName, 5);
  const [kind, setKind] = useState<ScheduleKind>("daily");
  const [intervalDays, setIntervalDays] = useState("2");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [foodNote, setFoodNote] = useState<FoodNote | null>(null);
  const [windowMinutes, setWindowMinutes] = useState<number>(0);
  const [steps, setSteps] = useState<TaperDraft[]>([{ days: "", times: "", doseText: "" }]);

  function addScheduleTime(time: string) {
    if (time && !scheduleTimes.includes(time)) setScheduleTimes((prev) => [...prev, time].sort());
  }
  function removeTime(time: string) {
    setScheduleTimes((prev) => prev.filter((t) => t !== time));
  }

  function pickSuggestion(entry: CatalogueEntry) {
    const pre = prefillFromCatalogue(entry);
    setDrugName(pre.drugName);
    setPickedName(pre.drugName);
    setFindings(null);
    if (pre.strength) setDose(pre.strength);
  }

  function resetForm() {
    setFindings(null);
    setDrugName("");
    setDose("");
    setFrequency("");
    setRefillDate("");
    setScheduleTimes([]);
    setStartedBySpecialist(false);
    setPrescriberName("");
    setKind("daily");
    setIntervalDays("2");
    setWeekdays([]);
    setStartDate("");
    setEndDate("");
    setFoodNote(null);
    setWindowMinutes(0);
    setSteps([{ days: "", times: "", doseText: "" }]);
  }

  /** The structured schedule the form describes, or null for the plain "every day at these times" case. */
  function buildSpec(): { spec: ScheduleSpec | null } | { error: string } {
    const plainDaily = kind === "daily" && !startDate.trim() && !endDate.trim() && foodNote === null && windowMinutes === 0;
    if (plainDaily) return { spec: null };
    const today = todayIsoDate();
    const common = { startDate: startDate.trim() || null, endDate: endDate.trim() || null, foodNote, windowMinutes: kind === "as_needed" ? 0 : windowMinutes };
    let raw: Record<string, unknown>;
    if (kind === "daily") raw = { ...common, kind, times: scheduleTimes };
    else if (kind === "every_n_days") raw = { ...common, startDate: common.startDate ?? today, kind, times: scheduleTimes, intervalDays: Number(intervalDays), anchorDate: common.startDate ?? today };
    else if (kind === "weekdays") raw = { ...common, kind, times: scheduleTimes, days: weekdays };
    else if (kind === "as_needed") raw = { ...common, kind };
    else
      raw = {
        ...common,
        startDate: common.startDate ?? today,
        kind,
        steps: steps.map((st) => ({
          days: Number(st.days),
          times: st.times.split(",").map((x) => x.trim()).filter(Boolean),
          doseText: st.doseText,
        })),
      };
    const parsed = parseScheduleSpec(raw);
    return parsed.ok ? { spec: parsed.spec } : { error: tr("meds.schedule.invalid") };
  }

  async function submit(skipCheck = false) {
    setError(null);
    setSuccess(false);
    const name = drugName.trim();
    if (!name) {
      setError("Drug name is required");
      return;
    }
    const built = buildSpec();
    if ("error" in built) {
      setError(built.error);
      return;
    }
    setPending(true);
    // The check only advises: it can pause the add to show a warning, never refuse it (spec 8.7).
    const guard = skipCheck ? "closed" : await loadInteractionCheckState();
    setCheckSkipped(guard === "unknown");
    if (guard === "open") {
      const check = checkMedicineOnAdd(
        name,
        existing.map((m) => ({ id: m.id, drugName: m.drug_name, dose: m.dose, prescriberName: m.prescriber_name, source: m.source })),
      );
      if (check.findings.length > 0) {
        setFindings(check.findings);
        setPending(false);
        return;
      }
    }
    setFindings(null);
    const result = await addMedication(patientId, {
      scheduleSpec: built.spec ?? undefined,
      drugName: name,
      dose: dose.trim() || undefined,
      frequency: frequency.trim() || undefined,
      refillDate: refillDate.trim() || undefined,
      scheduleTimes,
      startedBySpecialist,
      prescriberName: startedBySpecialist ? prescriberName.trim() || undefined : undefined,
    });
    setPending(false);
    if (result.error) {
      setError("We could not save this medication just then. Please try again.");
      return;
    }
    resetForm();
    setSuccess(true);
    setOpen(false);
    await onAdded();
  }

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <SectionLabel>Add a medication</SectionLabel>
        {!open ? <SmallGhostButton title="+ Add" onPress={() => setOpen(true)} /> : null}
      </View>
      {success && !open ? <MutedText>Medication added.</MutedText> : null}
      {success && !open ? <MutedText>{`${tr("medicines.mas.add_prompt")} ${tr("medicines.mas.caveat")}`}</MutedText> : null}
      {success && !open && checkSkipped ? <MutedText>{tr("medicines.addcheck.not_checked")}</MutedText> : null}
      {open ? (
        <Card style={{ gap: 10 }}>
          <View>
            <MutedText>Drug name</MutedText>
            <TextInput keyboardAppearance={scheme} value={drugName} onChangeText={(v) => { setDrugName(v); setFindings(null); }} style={inputStyle(colors)} placeholderTextColor={colors.subtle} accessibilityLabel={tr("medicines.search.label")} />
            {suggestions.length > 0 ? (
              <View style={{ marginTop: 6, gap: 4 }}>
                {suggestions.map(({ entry }) => (
                  <Pressable
                    key={entry.id}
                    accessibilityRole="button"
                    accessibilityLabel={catalogueLabel(entry)}
                    onPress={() => pickSuggestion(entry)}
                    style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 10, borderRadius: radius.control, backgroundColor: colors.groupBg }}
                  >
                    <Text style={{ fontSize: 14, color: colors.ink }}>{catalogueLabel(entry)}</Text>
                  </Pressable>
                ))}
                <MutedText>{tr("medicines.search.unverified")}</MutedText>
              </View>
            ) : drugName.trim().length >= 2 && catalogue.length > 0 ? (
              <MutedText>{tr("medicines.search.none")}</MutedText>
            ) : null}
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <MutedText>Dose</MutedText>
              <TextInput keyboardAppearance={scheme} value={dose} onChangeText={setDose} style={inputStyle(colors)} placeholder="e.g. 10mg" placeholderTextColor={colors.subtle} />
            </View>
            <View style={{ flex: 1 }}>
              <MutedText>Frequency</MutedText>
              <TextInput keyboardAppearance={scheme}
                value={frequency}
                onChangeText={setFrequency}
                style={inputStyle(colors)}
                placeholder="e.g. Twice daily"
                placeholderTextColor={colors.subtle}
              />
            </View>
          </View>
          <View>
            <MutedText>Refill date (optional, YYYY-MM-DD)</MutedText>
            <TextInput keyboardAppearance={scheme}
              value={refillDate}
              onChangeText={setRefillDate}
              style={inputStyle(colors)}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.subtle}
            />
          </View>
          <View style={{ gap: 6 }}>
            <MutedText>{tr("meds.schedule.title")}</MutedText>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {SCHEDULE_KINDS.map((k) => (
                <SmallGhostButton key={k} title={(kind === k ? "✓ " : "") + tr(`meds.schedule.kind.${k}` as MessageKey)} onPress={() => setKind(k)} />
              ))}
            </View>
            {kind === "every_n_days" ? (
              <View>
                <MutedText>{tr("meds.schedule.interval")}</MutedText>
                <TextInput keyboardAppearance={scheme} value={intervalDays} onChangeText={setIntervalDays} keyboardType="number-pad" style={inputStyle(colors)} placeholderTextColor={colors.subtle} />
              </View>
            ) : null}
            {kind === "weekdays" ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                  <SmallGhostButton
                    key={d}
                    title={(weekdays.includes(d) ? "✓ " : "") + tr(`meds.weekday.${d}` as MessageKey)}
                    onPress={() => setWeekdays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))}
                  />
                ))}
              </View>
            ) : null}
            {kind === "taper" ? (
              <View style={{ gap: 8 }}>
                {steps.map((st, i) => (
                  <View key={i} style={{ gap: 6 }}>
                    <MutedText>{tr("meds.schedule.taper_step", { n: i + 1, days: st.days || "?" })}</MutedText>
                    <TextInput keyboardAppearance={scheme} value={st.days} onChangeText={(v) => setSteps((prev) => prev.map((x, j) => (j === i ? { ...x, days: v } : x)))} keyboardType="number-pad" placeholder="7" style={inputStyle(colors)} placeholderTextColor={colors.subtle} />
                    <TextInput keyboardAppearance={scheme} value={st.times} onChangeText={(v) => setSteps((prev) => prev.map((x, j) => (j === i ? { ...x, times: v } : x)))} placeholder="08:00, 20:00" style={inputStyle(colors)} placeholderTextColor={colors.subtle} />
                    <TextInput keyboardAppearance={scheme} value={st.doseText} onChangeText={(v) => setSteps((prev) => prev.map((x, j) => (j === i ? { ...x, doseText: v } : x)))} placeholder={tr("meds.schedule.taper_dose")} style={inputStyle(colors)} placeholderTextColor={colors.subtle} />
                  </View>
                ))}
                <SmallGhostButton title={tr("meds.schedule.taper_add")} onPress={() => setSteps((prev) => [...prev, { days: "", times: "", doseText: "" }])} />
              </View>
            ) : null}
            <View>
              <MutedText>{tr("meds.schedule.start_date")}</MutedText>
              <TextInput keyboardAppearance={scheme} value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" style={inputStyle(colors)} placeholderTextColor={colors.subtle} />
            </View>
            <View>
              <MutedText>{tr("meds.schedule.end_date")}</MutedText>
              <TextInput keyboardAppearance={scheme} value={endDate} onChangeText={setEndDate} placeholder="YYYY-MM-DD" style={inputStyle(colors)} placeholderTextColor={colors.subtle} />
            </View>
            {kind === "as_needed" ? null : (
              <View style={{ gap: 6 }}>
                <MutedText>{tr("meds.window.title")}</MutedText>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {WINDOW_CHOICES.map((w) => (
                    <SmallGhostButton key={w} title={(windowMinutes === w ? "✓ " : "") + tr(`meds.window.${w}` as MessageKey)} onPress={() => setWindowMinutes(w)} />
                  ))}
                </View>
              </View>
            )}
            <MutedText>{tr("meds.schedule.food_note")}</MutedText>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {FOOD_NOTES.map((f) => (
                <SmallGhostButton key={f} title={(foodNote === f ? "✓ " : "") + tr(`meds.food.${f}` as MessageKey)} onPress={() => setFoodNote(foodNote === f ? null : f)} />
              ))}
            </View>
          </View>
          <View style={{ gap: 6, display: kind === "taper" || kind === "as_needed" ? "none" : "flex" }}>
            <MutedText>Dose times</MutedText>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {DOSE_TIME_PRESETS.map((preset) => (
                <SmallGhostButton key={preset.label} title={preset.label} onPress={() => addScheduleTime(preset.time)} />
              ))}
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput keyboardAppearance={scheme}
                value={newTime}
                onChangeText={setNewTime}
                style={[inputStyle(colors), { flex: 1 }]}
                placeholder="HH:MM"
                placeholderTextColor={colors.subtle}
              />
              <SmallGhostButton
                title="Add"
                onPress={() => {
                  addScheduleTime(newTime);
                  setNewTime("");
                }}
              />
            </View>
            {scheduleTimes.length > 0 ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {scheduleTimes.map((time) => (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${time}`} key={time} onPress={() => removeTime(time)} style={{ backgroundColor: colors.pressed, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10 }}>
                    <Text style={{ fontSize: 12, color: colors.ink }}>{time} ×</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: startedBySpecialist }}
            onPress={() => setStartedBySpecialist((v) => !v)}
            style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
          >
            <View
              style={{
                width: 20,
                height: 20,
                borderRadius: 5,
                borderWidth: 1.5,
                borderColor: startedBySpecialist ? colors.brand : colors.border,
                backgroundColor: startedBySpecialist ? colors.brand : "transparent",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {startedBySpecialist ? <Ionicons name="checkmark" size={13} color="#fff" /> : null}
            </View>
            <Text style={{ fontSize: 13.5, color: colors.ink }}>A specialist started this medication</Text>
          </Pressable>
          {startedBySpecialist ? (
            <View>
              <MutedText>Specialist name</MutedText>
              <TextInput keyboardAppearance={scheme}
                value={prescriberName}
                onChangeText={setPrescriberName}
                style={inputStyle(colors)}
                placeholder="e.g. Dr. Adeyemi (Cardiologist)"
                placeholderTextColor={colors.subtle}
              />
            </View>
          ) : null}
          <MutedText>{tr("meds.confirm.body")}</MutedText>
          {error ? <ErrorText>{error}</ErrorText> : null}
          {findings && findings.length > 0 ? (
            <View accessibilityRole="alert" style={{ gap: 8, padding: 10, borderRadius: radius.control, backgroundColor: colors.groupBg }}>
              <Text style={{ fontSize: 14, fontWeight: "600", color: colors.ink }}>{tr("medicines.addcheck.title")}</Text>
              {findings.map((f, i) => (
                <View key={`${f.adviceKey}-${i}`} style={{ gap: 2 }}>
                  <MutedText>{[...new Set(f.drugNames)].join(" · ")}</MutedText>
                  <Text style={{ fontSize: 14, color: colors.ink }}>{tr(f.adviceKey)}</Text>
                </View>
              ))}
              <MutedText>{tr("medicines.addcheck.limits")}</MutedText>
              <SecondaryButton title={tr("medicines.addcheck.continue")} onPress={() => void submit(true)} disabled={pending} />
            </View>
          ) : null}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <PrimaryButton title={pending ? "Saving…" : "Add medication"} onPress={() => void submit()} disabled={pending} />
            </View>
            <View style={{ flex: 1 }}>
              <SecondaryButton title="Cancel" onPress={() => setOpen(false)} disabled={pending} />
            </View>
          </View>
        </Card>
      ) : null}
    </View>
  );
}

// --- Adherence check-in -------------------------------------------------------

function CheckinCard({ checkin, onAnswered }: { checkin: AdherenceCheckinItem; onAnswered: () => Promise<void> }) {
  const { scheme } = useTheme();
  const colors = useLegacyColors();
  const [answer, setAnswer] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function send() {
    if (!answer.trim()) return;
    setPending(true);
    setError(false);
    const result = await respondToCheckin(checkin.id, answer.trim());
    setPending(false);
    if (result.error) {
      setError(true);
      return;
    }
    setAnswer("");
    await onAnswered();
  }

  return (
    <Card style={{ gap: 8 }}>
      <Text style={{ fontSize: 13.5, color: colors.ink }}>{checkinQuestion(checkin.checkin_type, checkin.drug_name)}</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput keyboardAppearance={scheme}
          value={answer}
          onChangeText={setAnswer}
          style={[inputStyle(colors), { flex: 1 }]}
          placeholder="Your answer"
          placeholderTextColor={colors.subtle}
        />
        <SmallGhostButton title={pending ? "Sending…" : "Send"} onPress={send} disabled={pending || !answer.trim()} />
      </View>
      {error ? <ErrorText>Could not save your answer. Try again.</ErrorText> : null}
    </Card>
  );
}

// --- Lab monitoring row --------------------------------------------------------

function LabMonitoringRow({ item, isFirst }: { item: LabMonitoringItem; isFirst: boolean }) {
  const colors = useLegacyColors();
  const overdue = item.due_date != null && new Date(item.due_date) < new Date(new Date().toDateString());
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        paddingVertical: 11,
        paddingHorizontal: spacing.card,
        borderTopWidth: isFirst ? 0 : 1,
        borderTopColor: colors.border,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13.5, color: colors.ink }}>{item.monitoring_label}</Text>
        <MutedText>{item.drug_name ? `For ${item.drug_name}` : item.drug_class}</MutedText>
      </View>
      {item.due_date ? (
        <Pill tone={overdue ? "red" : "amber"}>{`${overdue ? "Overdue" : "Due"} ${formatDate(item.due_date)}`}</Pill>
      ) : (
        <Pill tone="grey">As indicated</Pill>
      )}
    </View>
  );
}

// --- Check my pack --------------------------------------------------------------

interface CapturedPhoto {
  uri: string;
}

const VERDICT_COPY: Record<PackCheckResult["verdict"], { tone: "green" | "amber" | "grey"; label: string; body: string }> = {
  matches_prescription: {
    tone: "green",
    label: "Matches your prescription",
    body: "The name and strength you entered match what you were prescribed.",
  },
  strength_differs: {
    tone: "amber",
    label: "Different strength",
    body: "This is the right medicine but a different strength from the one on your record. That can be deliberate, but check before you take it.",
  },
  strength_unknown: {
    tone: "grey",
    label: "Right medicine",
    body: "This medicine is on your list. We do not have a strength recorded for it, so there was nothing to compare against.",
  },
  not_on_your_list: {
    tone: "amber",
    label: "Not on your list",
    body: "We could not match this to any medicine currently on your record. That is expected for something bought over the counter.",
  },
  unreadable: {
    tone: "grey",
    label: "Nothing to compare",
    body: "Enter the drug name printed on the pack to check it.",
  },
};

/**
 * "Is this the right box?" — same comparison and NAFDAC framing as the web
 * CheckMyPack, with a typed reading in place of an AI-read one (see
 * checkPackAgainstPrescription's header comment in lib/medications.ts).
 */
function CheckMyPackSection({ medications }: { medications: MedicationCabinetItem[] }) {
  const { scheme } = useTheme();
  const colors = useLegacyColors();
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [packDrugName, setPackDrugName] = useState("");
  const [packStrength, setPackStrength] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PackCheckResult | null>(null);

  async function takePhoto() {
    setError(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError("Camera access is off. Enable it in your phone's Settings to photograph a pack.");
      return;
    }
    const picked = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (picked.canceled || !picked.assets[0]) return;
    setPhoto({ uri: picked.assets[0].uri });
  }

  async function chooseFromLibrary() {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Photo access is off. Enable it in your phone's Settings to choose a photo.");
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({ quality: 0.6 });
    if (picked.canceled || !picked.assets[0]) return;
    setPhoto({ uri: picked.assets[0].uri });
  }

  function check() {
    setError(null);
    const name = packDrugName.trim();
    if (!name) {
      setError("Enter the drug name printed on the pack.");
      return;
    }
    setResult(
      checkPackAgainstPrescription(
        { drugName: name, strength: packStrength.trim() || null },
        medications.map((m) => ({ drugName: m.drug_name, dose: m.dose }))
      )
    );
  }

  const verdict = result ? VERDICT_COPY[result.verdict] : null;

  return (
    <View style={{ gap: 10 }}>
      <SectionLabel>Check a medicine pack</SectionLabel>
      <Card style={{ gap: 10 }}>
        <MutedText>
          Photograph a pack you have just bought for your own reference, then type the name and strength printed on it — we&apos;ll compare it
          with what you were prescribed.
        </MutedText>
        {photo ? (
          <Image source={{ uri: photo.uri }} style={{ width: "100%", height: 160, borderRadius: radius.control, backgroundColor: colors.border }} resizeMode="cover" />
        ) : null}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <SecondaryButton title={photo ? "Retake photo" : "Take a photo"} onPress={takePhoto} />
          </View>
          <View style={{ flex: 1 }}>
            <SecondaryButton title="Choose from library" onPress={chooseFromLibrary} />
          </View>
        </View>
        <View>
          <MutedText>Drug name on pack</MutedText>
          <TextInput keyboardAppearance={scheme} value={packDrugName} onChangeText={setPackDrugName} style={inputStyle(colors)} placeholderTextColor={colors.subtle} />
        </View>
        <View>
          <MutedText>Strength on pack (optional, e.g. 10mg)</MutedText>
          <TextInput keyboardAppearance={scheme} value={packStrength} onChangeText={setPackStrength} style={inputStyle(colors)} placeholderTextColor={colors.subtle} />
        </View>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <PrimaryButton title="Check this pack" onPress={check} />

        {result && verdict ? (
          <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, marginTop: 2 }}>
            <Pill tone={verdict.tone}>{verdict.label}</Pill>
            <Text style={{ fontSize: 13.5, color: colors.ink, lineHeight: 19 }}>{verdict.body}</Text>
            {result.verdict === "strength_differs" ? (
              <View style={{ backgroundColor: colors.status.warnBg, borderRadius: radius.control, padding: 10 }}>
                <Text style={{ fontSize: 12.5, color: colors.status.warn, lineHeight: 18 }}>
                  The pack says {result.packStrength?.value}
                  {result.packStrength?.unit}. Your record says {result.prescribedStrength?.value}
                  {result.prescribedStrength?.unit} of {result.matchedDrugName}. Ask your care team before taking it.
                </Text>
              </View>
            ) : null}
            <View style={{ backgroundColor: colors.groupBg, borderRadius: radius.control, padding: 10, gap: 4 }}>
              <Text style={{ fontSize: 12, fontWeight: "700", color: colors.ink }}>Is it genuine? We cannot tell you that. NAFDAC can.</Text>
              <Text style={{ fontSize: 12, color: colors.muted, lineHeight: 17 }}>{NAFDAC_MAS.howTo}</Text>
              <Text style={{ fontSize: 11.5, color: colors.subtle, lineHeight: 16 }}>{NAFDAC_MAS.caveat}</Text>
            </View>
          </View>
        ) : null}
      </Card>
    </View>
  );
}

/**
 * Side effects to share (spec 8.7): a short note in the person's own words that the care team sees at the next consultation.
 * It changes no medicine, dose or schedule and raises no alert; a person who feels very unwell is pointed at the emergency steps.
 */
function SideEffectNoteSection({ medicationId }: { medicationId: string }) {
  const { scheme } = useTheme();
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const tr = (key: MessageKey) => t(key, locale);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);

  async function save() {
    setPending(true);
    setError(false);
    const result = await addSideEffectNote(medicationId, note);
    setPending(false);
    if (result.error) {
      setError(true);
      return;
    }
    setNote("");
    setSaved(true);
    setOpen(false);
  }

  if (!open) {
    return (
      <View style={{ gap: 4 }}>
        <SmallGhostButton title={tr("medicines.sideeffect.add")} onPress={() => { setSaved(false); setOpen(true); }} />
        {saved ? <MutedText>{tr("medicines.sideeffect.saved")}</MutedText> : null}
      </View>
    );
  }
  return (
    <View style={{ gap: 8, marginTop: 6, backgroundColor: colors.groupBg, borderRadius: radius.control, padding: 10 }}>
      <MutedText>{tr("medicines.sideeffect.title")}</MutedText>
      <MutedText>{tr("medicines.sideeffect.hint")}</MutedText>
      <TextInput keyboardAppearance={scheme} value={note} onChangeText={setNote} maxLength={500} multiline style={inputStyle(colors)} placeholderTextColor={colors.subtle} accessibilityLabel={tr("medicines.sideeffect.title")} />
      <MutedText>{tr("medicines.sideeffect.urgent")}</MutedText>
      {error ? <ErrorText>We could not save that just now. Please try again.</ErrorText> : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <PrimaryButton title={pending ? "Saving…" : tr("medicines.sideeffect.add")} onPress={() => void save()} disabled={pending || note.trim().length === 0} />
        </View>
        <View style={{ flex: 1 }}>
          <SecondaryButton title="Cancel" onPress={() => setOpen(false)} disabled={pending} />
        </View>
      </View>
    </View>
  );
}
