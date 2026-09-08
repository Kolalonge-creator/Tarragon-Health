import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import {
  addMedication,
  checkPackAgainstPrescription,
  checkinQuestion,
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
import { colors, inkAlpha, radius, spacing } from "@/ui/theme";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton, SectionLabel } from "@/ui/components";

interface MedicineCabinetScreenProps {
  patientId: string;
  organisationId: string;
}

const inputStyle = {
  height: 40,
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radius.control,
  paddingHorizontal: 12,
  fontSize: 14,
  color: colors.ink,
  backgroundColor: colors.card,
} as const;

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
  const styles: Record<string, { bg: string; text: string }> = {
    green: { bg: colors.brandTint, text: colors.brandPressed },
    amber: { bg: colors.status.warnBg, text: colors.status.warn },
    grey: { bg: inkAlpha(0.08), text: colors.muted },
    red: { bg: "#FBE9E7", text: colors.danger },
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
 * reporting, the paid prescription-renewal purchase flow, prescription
 * amendment, and past (stopped) medications history. "Check my pack" keeps
 * the photo step for the patient's own reference but compares a typed
 * reading instead of an AI OCR read — see checkPackAgainstPrescription's
 * header comment in lib/medications.ts for why.
 */
export function MedicineCabinetScreen({ patientId, organisationId }: MedicineCabinetScreenProps) {
  const [medications, setMedications] = useState<MedicationCabinetItem[]>([]);
  const [medsLoading, setMedsLoading] = useState(true);
  const [medsError, setMedsError] = useState(false);

  const [collections, setCollections] = useState<MedicationCollectionItem[]>([]);
  const [requests, setRequests] = useState<RepeatRequestItem[]>([]);
  const [checkins, setCheckins] = useState<AdherenceCheckinItem[]>([]);
  const [checkinsError, setCheckinsError] = useState(false);
  const [labMonitoring, setLabMonitoring] = useState<LabMonitoringItem[]>([]);
  const [labMonitoringError, setLabMonitoringError] = useState(false);

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

      <AddMedicationSection patientId={patientId} onAdded={load} />

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
  latestCollection,
  latestRequest,
  onChanged,
}: {
  medication: MedicationCabinetItem;
  patientId: string;
  organisationId: string;
  latestCollection: MedicationCollectionItem | null;
  latestRequest: RepeatRequestItem | null;
  onChanged: () => Promise<void>;
}) {
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

      {collectOpen ? (
        <View style={{ gap: 8, marginTop: 6, backgroundColor: colors.groupBg, borderRadius: radius.control, padding: 10 }}>
          <View>
            <MutedText>Date collected (YYYY-MM-DD)</MutedText>
            <TextInput value={collectedOn} onChangeText={setCollectedOn} style={inputStyle} placeholder="YYYY-MM-DD" placeholderTextColor={colors.faint} />
          </View>
          <View>
            <MutedText>Pharmacy (optional)</MutedText>
            <TextInput
              value={pharmacyName}
              onChangeText={setPharmacyName}
              style={inputStyle}
              placeholder="e.g. HealthPlus"
              placeholderTextColor={colors.faint}
            />
          </View>
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

function SmallGhostButton({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({ opacity: disabled ? 0.5 : pressed ? 0.6 : 1, paddingVertical: 6 })}
    >
      <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.brand }}>{title}</Text>
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

function AddMedicationSection({ patientId, onAdded }: { patientId: string; onAdded: () => Promise<void> }) {
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

  function addScheduleTime(time: string) {
    if (time && !scheduleTimes.includes(time)) setScheduleTimes((prev) => [...prev, time].sort());
  }
  function removeTime(time: string) {
    setScheduleTimes((prev) => prev.filter((t) => t !== time));
  }

  function resetForm() {
    setDrugName("");
    setDose("");
    setFrequency("");
    setRefillDate("");
    setScheduleTimes([]);
    setStartedBySpecialist(false);
    setPrescriberName("");
  }

  async function submit() {
    setError(null);
    setSuccess(false);
    const name = drugName.trim();
    if (!name) {
      setError("Drug name is required");
      return;
    }
    setPending(true);
    const result = await addMedication(patientId, {
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
      {open ? (
        <Card style={{ gap: 10 }}>
          <View>
            <MutedText>Drug name</MutedText>
            <TextInput value={drugName} onChangeText={setDrugName} style={inputStyle} placeholderTextColor={colors.faint} />
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <MutedText>Dose</MutedText>
              <TextInput value={dose} onChangeText={setDose} style={inputStyle} placeholder="e.g. 10mg" placeholderTextColor={colors.faint} />
            </View>
            <View style={{ flex: 1 }}>
              <MutedText>Frequency</MutedText>
              <TextInput
                value={frequency}
                onChangeText={setFrequency}
                style={inputStyle}
                placeholder="e.g. Twice daily"
                placeholderTextColor={colors.faint}
              />
            </View>
          </View>
          <View>
            <MutedText>Refill date (optional, YYYY-MM-DD)</MutedText>
            <TextInput
              value={refillDate}
              onChangeText={setRefillDate}
              style={inputStyle}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.faint}
            />
          </View>
          <View style={{ gap: 6 }}>
            <MutedText>Dose times</MutedText>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {DOSE_TIME_PRESETS.map((preset) => (
                <SmallGhostButton key={preset.label} title={preset.label} onPress={() => addScheduleTime(preset.time)} />
              ))}
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput
                value={newTime}
                onChangeText={setNewTime}
                style={[inputStyle, { flex: 1 }]}
                placeholder="HH:MM"
                placeholderTextColor={colors.faint}
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
                  <Pressable key={time} onPress={() => removeTime(time)} style={{ backgroundColor: inkAlpha(0.08), borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10 }}>
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
              <TextInput
                value={prescriberName}
                onChangeText={setPrescriberName}
                style={inputStyle}
                placeholder="e.g. Dr. Adeyemi (Cardiologist)"
                placeholderTextColor={colors.faint}
              />
            </View>
          ) : null}
          {error ? <ErrorText>{error}</ErrorText> : null}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <PrimaryButton title={pending ? "Saving…" : "Add medication"} onPress={submit} disabled={pending} />
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
        <TextInput
          value={answer}
          onChangeText={setAnswer}
          style={[inputStyle, { flex: 1 }]}
          placeholder="Your answer"
          placeholderTextColor={colors.faint}
        />
        <SmallGhostButton title={pending ? "Sending…" : "Send"} onPress={send} disabled={pending || !answer.trim()} />
      </View>
      {error ? <ErrorText>Could not save your answer. Try again.</ErrorText> : null}
    </Card>
  );
}

// --- Lab monitoring row --------------------------------------------------------

function LabMonitoringRow({ item, isFirst }: { item: LabMonitoringItem; isFirst: boolean }) {
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
          <TextInput value={packDrugName} onChangeText={setPackDrugName} style={inputStyle} placeholderTextColor={colors.faint} />
        </View>
        <View>
          <MutedText>Strength on pack (optional, e.g. 10mg)</MutedText>
          <TextInput value={packStrength} onChangeText={setPackStrength} style={inputStyle} placeholderTextColor={colors.faint} />
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
              <Text style={{ fontSize: 11.5, color: colors.faint, lineHeight: 16 }}>{NAFDAC_MAS.caveat}</Text>
            </View>
          </View>
        ) : null}
      </Card>
    </View>
  );
}
