import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import {
  createCorrectionRequest,
  createDeletionRequest,
  createExportRequest,
  loadConnectedDevices,
  loadConsentStatus,
  loadCorrectionRequests,
  loadDeletionRequests,
  loadExportRequests,
  type ConnectedDevice,
  type ConsentRow,
  type DataRightsRequest,
} from "@/lib/privacy";
import { PLATFORM_URL } from "@/lib/platform-url";
import type { SectionId } from "@/lib/sections";
import { colors, radius, spacing } from "@/ui/theme";
import { Badge, CalloutCard, Card, ErrorText, MutedText, PrimaryButton, ScreenTitle, SecondaryButton } from "@/ui/components";

const CONSENT_TYPE_LABEL: Record<string, string> = {
  data_processing: "Data processing",
  telehealth: "Telehealth",
  terms_of_service: "Terms of service",
  device_data: "Device & wearable data",
  marketing: "Marketing communications",
  research: "Research use",
};

const POSITIVE_STATUSES = new Set(["applied", "completed", "fulfilled", "approved", "approved_partial", "approved_full"]);

const textInputStyle = {
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radius.control,
  paddingHorizontal: 10,
  paddingVertical: 8,
  fontSize: 14,
  color: colors.ink,
} as const;

function when(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

interface PrivacyScreenProps {
  userId: string;
  organisationId: string;
  onNavigate: (section: SectionId) => void;
}

/**
 * "Privacy & your data" — mirrors apps/web/.../patient/privacy/page.tsx:
 * per-type consent status, a read-only connected-devices summary, and the
 * three data-rights request workflows (export/correction/deletion). See
 * lib/privacy.ts's header comment for why care-visibility (who can see my
 * record) links to "family" rather than being duplicated here.
 */
export function PrivacyScreen({ userId, organisationId, onNavigate }: PrivacyScreenProps) {
  const [loading, setLoading] = useState(true);
  const [consents, setConsents] = useState<ConsentRow[]>([]);
  const [devices, setDevices] = useState<ConnectedDevice[]>([]);
  const [exportRequests, setExportRequests] = useState<DataRightsRequest[]>([]);
  const [correctionRequests, setCorrectionRequests] = useState<DataRightsRequest[]>([]);
  const [deletionRequests, setDeletionRequests] = useState<DataRightsRequest[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [consentResult, deviceList, exportList, correctionList, deletionList] = await Promise.all([
      loadConsentStatus(userId),
      loadConnectedDevices(userId),
      loadExportRequests(),
      loadCorrectionRequests(),
      loadDeletionRequests(),
    ]);
    if (!consentResult.ok) {
      setLoadError(consentResult.error);
      return;
    }
    setLoadError(null);
    setConsents(consentResult.data);
    setDevices(deviceList);
    setExportRequests(exportList);
    setCorrectionRequests(correctionList);
    setDeletionRequests(deletionList);
  }, [userId]);

  useEffect(() => {
    refresh()
      .catch(() => setLoadError("Could not load your privacy settings."))
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
        <ScreenTitle>Privacy & your data</ScreenTitle>
        <MutedText>
          What you&apos;ve agreed to, who can see your record, and how to request, correct, or delete
          your data.
        </MutedText>
      </View>

      {loadError && (
        <Card>
          <ErrorText>{loadError}</ErrorText>
        </Card>
      )}

      <Card style={{ gap: 8 }}>
        <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Your consent</Text>
        <MutedText>What you&apos;ve agreed to, by category.</MutedText>
        {consents.length === 0 ? (
          <MutedText>Nothing to show yet.</MutedText>
        ) : (
          consents.map((c) => (
            <View key={`${c.consentType}-${c.version}`} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, color: colors.ink }}>{CONSENT_TYPE_LABEL[c.consentType] ?? c.consentType.replace(/_/g, " ")}</Text>
                <MutedText>{c.accepted && c.acceptedAt ? `Accepted ${when(c.acceptedAt)} · v${c.version}` : "Not yet recorded"}</MutedText>
              </View>
              <Badge tone={c.accepted ? "brand" : "neutral"}>{c.accepted ? "Accepted" : "Outstanding"}</Badge>
            </View>
          ))
        )}
      </Card>

      <Card style={{ gap: 8 }}>
        <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Connected devices</Text>
        <MutedText>Services currently sharing data into your record.</MutedText>
        {devices.length === 0 ? (
          <MutedText>No devices connected.</MutedText>
        ) : (
          devices.map((d) => (
            <View key={d.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 6 }}>
              <Text style={{ fontSize: 13, color: colors.ink, textTransform: "capitalize" }}>{d.provider.replace(/_/g, " ")}</Text>
              <MutedText>{d.connectedAt ? `Connected ${when(d.connectedAt)}` : "—"}</MutedText>
            </View>
          ))
        )}
        <SecondaryButton
          title="Manage device connections"
          onPress={() => void WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/vitals#connect-devices`)}
        />
      </Card>

      <CalloutCard
        icon="eye-outline"
        title="Who can see your health information"
        subtitle="Next of kin, care visibility categories, and pending access requests."
        ctaLabel="Open Your people"
        onPress={() => onNavigate("family")}
      />

      <View>
        <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink, marginBottom: 4 }}>Your data rights</Text>
        <MutedText>
          Under Nigeria&apos;s Data Protection Act, you can ask to see, correct, or delete the data we
          hold about you.
        </MutedText>
      </View>

      <ExportRequestCard userId={userId} organisationId={organisationId} requests={exportRequests} onChanged={refresh} />
      <CorrectionRequestCard userId={userId} organisationId={organisationId} requests={correctionRequests} onChanged={refresh} />
      <DeletionRequestCard userId={userId} organisationId={organisationId} requests={deletionRequests} onChanged={refresh} />
    </ScrollView>
  );
}

function RequestList({ requests }: { requests: DataRightsRequest[] }) {
  if (requests.length === 0) return null;
  return (
    <View style={{ gap: 6, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
      {requests.map((r) => (
        <View key={r.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <Text style={{ fontSize: 12.5, color: colors.muted, flex: 1 }} numberOfLines={1}>
            {r.summary || "Request"} · {when(r.requestedAt)}
          </Text>
          <Badge tone={POSITIVE_STATUSES.has(r.status) ? "brand" : "neutral"}>{r.status.replace(/_/g, " ")}</Badge>
        </View>
      ))}
    </View>
  );
}

function ExportRequestCard({
  userId,
  organisationId,
  requests,
  onChanged,
}: {
  userId: string;
  organisationId: string;
  requests: DataRightsRequest[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setSubmitting(true);
    const result = await createExportRequest(organisationId, userId, note.trim() || undefined);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    setNote("");
    onChanged();
  }

  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Request a copy of your data</Text>
      <MutedText>
        Ask us for a copy of the data we hold about you. A member of our team reviews and prepares
        it, then sends it to you securely — it isn&apos;t a direct download.
      </MutedText>
      {error && <ErrorText>{error}</ErrorText>}
      {open ? (
        <>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Anything specific you need? (optional)"
            multiline
            numberOfLines={2}
            style={[textInputStyle, { minHeight: 50, textAlignVertical: "top" }]}
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <PrimaryButton title="Submit request" onPress={submit} loading={submitting} />
            <SecondaryButton title="Cancel" onPress={() => setOpen(false)} disabled={submitting} />
          </View>
        </>
      ) : (
        <SecondaryButton title="Request my data" onPress={() => setOpen(true)} />
      )}
      <RequestList requests={requests} />
    </Card>
  );
}

function CorrectionRequestCard({
  userId,
  organisationId,
  requests,
  onChanged,
}: {
  userId: string;
  organisationId: string;
  requests: DataRightsRequest[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [recordDescription, setRecordDescription] = useState("");
  const [whatIsWrong, setWhatIsWrong] = useState("");
  const [requestedChange, setRequestedChange] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setSubmitting(true);
    const result = await createCorrectionRequest(organisationId, userId, {
      recordDescription,
      whatIsWrong,
      requestedChange: requestedChange.trim() || undefined,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    setRecordDescription("");
    setWhatIsWrong("");
    setRequestedChange("");
    onChanged();
  }

  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Request a correction</Text>
      <MutedText>
        See something wrong in your record? Tell us what it is. A member of your care team reviews
        every request before anything changes.
      </MutedText>
      {error && <ErrorText>{error}</ErrorText>}
      {open ? (
        <>
          <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>Which record?</Text>
          <TextInput
            value={recordDescription}
            onChangeText={setRecordDescription}
            placeholder="e.g. my date of birth, a blood pressure reading from last week"
            multiline
            numberOfLines={2}
            style={[textInputStyle, { minHeight: 50, textAlignVertical: "top" }]}
          />
          <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>What&apos;s wrong with it?</Text>
          <TextInput value={whatIsWrong} onChangeText={setWhatIsWrong} multiline numberOfLines={2} style={[textInputStyle, { minHeight: 50, textAlignVertical: "top" }]} />
          <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>What should it say instead? (optional)</Text>
          <TextInput value={requestedChange} onChangeText={setRequestedChange} multiline numberOfLines={2} style={[textInputStyle, { minHeight: 50, textAlignVertical: "top" }]} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <PrimaryButton
              title="Submit request"
              onPress={submit}
              loading={submitting}
              disabled={!recordDescription.trim() || !whatIsWrong.trim()}
            />
            <SecondaryButton title="Cancel" onPress={() => setOpen(false)} disabled={submitting} />
          </View>
        </>
      ) : (
        <SecondaryButton title="Request a correction" onPress={() => setOpen(true)} />
      )}
      <RequestList requests={requests} />
    </Card>
  );
}

function DeletionRequestCard({
  userId,
  organisationId,
  requests,
  onChanged,
}: {
  userId: string;
  organisationId: string;
  requests: DataRightsRequest[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setSubmitting(true);
    const result = await createDeletionRequest(organisationId, userId, reason.trim());
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    setReason("");
    onChanged();
  }

  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>Request deletion of your data</Text>
      <MutedText>
        You can ask us to delete data we hold about you. Some clinical records must be kept for a
        minimum period under Nigerian healthcare regulation. If that applies, we&apos;ll explain
        exactly what can and can&apos;t be deleted when we review your request.
      </MutedText>
      {error && <ErrorText>{error}</ErrorText>}
      {open ? (
        <>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Tell us what you'd like deleted and why (optional)"
            multiline
            numberOfLines={3}
            style={[textInputStyle, { minHeight: 60, textAlignVertical: "top" }]}
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <PrimaryButton title="Submit request" onPress={submit} loading={submitting} />
            <SecondaryButton title="Cancel" onPress={() => setOpen(false)} disabled={submitting} />
          </View>
        </>
      ) : (
        <SecondaryButton title="Request deletion" onPress={() => setOpen(true)} />
      )}
      <RequestList requests={requests} />
    </Card>
  );
}
