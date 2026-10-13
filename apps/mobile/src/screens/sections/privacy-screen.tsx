import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import type { ConsentReceiptRow } from "@tarragon/shared";
import {
  createCorrectionRequest,
  loadConnectedDevices,
  loadConsentReceipts,
  loadConsentStatus,
  loadCorrectionRequests,
  loadDeletionRequests,
  loadExportRequests,
  type ConnectedDevice,
  type ConsentRow,
  type DataRightsRequest,
  type DeletionRequestRow,
  type ExportRequestRow,
} from "@/lib/privacy";
import { OptionalConsentControls, ConsentReceiptsCard } from "./privacy-consent-controls";
import { DeletionRequestCard, ExportRequestCard } from "./privacy-data-cards";
import { PLATFORM_URL } from "@/lib/platform-url";
import type { SectionId } from "@/lib/sections";
import { spacing } from "@/ui/theme";
import { useLegacyColors, useTextInputStyle, useTheme, placeholderColorFor } from "@/ui/design";
import { Badge, CalloutCard, Card, ErrorText, MutedText, PrimaryButton, ScreenTitle, SecondaryButton } from "@/ui/legacy-kit";

const CONSENT_TYPE_LABEL: Record<string, string> = {
  data_processing: "Data processing",
  telehealth: "Telehealth",
  terms_of_service: "Terms of service",
  device_data: "Device & wearable data",
  marketing: "Marketing communications",
  research: "Research use",
};

const POSITIVE_STATUSES = new Set(["applied", "completed", "fulfilled", "approved", "approved_partial", "approved_full"]);

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
  const colors = useLegacyColors();
  const [loading, setLoading] = useState(true);
  const [consents, setConsents] = useState<ConsentRow[]>([]);
  const [devices, setDevices] = useState<ConnectedDevice[]>([]);
  const [receipts, setReceipts] = useState<ConsentReceiptRow[]>([]);
  const [receiptsError, setReceiptsError] = useState<string | null>(null);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [exportRequests, setExportRequests] = useState<ExportRequestRow[]>([]);
  const [correctionRequests, setCorrectionRequests] = useState<DataRightsRequest[]>([]);
  const [deletionRequests, setDeletionRequests] = useState<DeletionRequestRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [consentResult, receiptResult, deviceList, exportList, correctionList, deletionList] = await Promise.all([
      loadConsentStatus(userId),
      loadConsentReceipts(userId),
      loadConnectedDevices(userId),
      loadExportRequests(userId),
      loadCorrectionRequests(userId),
      loadDeletionRequests(userId),
    ]);
    // A failed consent load must not stop the request lists from being set: an unset deletion list reads as "no pending request".
    setLoadError(consentResult.ok ? null : consentResult.error);
    setConsents(consentResult.ok ? consentResult.data : []);
    setReceipts(receiptResult.ok ? receiptResult.data : []);
    setReceiptsError(receiptResult.ok ? null : "We could not load your consent receipts just now.");
    // A failed load must never look like "no requests": the deletion card would hide a pending request and its cancel button.
    setRequestsError(
      exportList.ok && deletionList.ok && correctionList.ok && deviceList.ok ? null : "We could not load your data requests just now. Please try again before starting a new one.",
    );
    setDevices(deviceList.ok ? deviceList.data : []);
    setExportRequests(exportList.ok ? exportList.data : []);
    setCorrectionRequests(correctionList.ok ? correctionList.data : []);
    setDeletionRequests(deletionList.ok ? deletionList.data : []);
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
          What you&apos;ve agreed to, who can see your record, and how to get a copy of your data, correct it, or close
          your account.
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
        {loadError ? (
          <MutedText>We could not load your consent choices just now, so we are not showing them.</MutedText>
        ) : consents.length === 0 ? (
          <MutedText>Nothing to show yet.</MutedText>
        ) : (
          consents.map((c) => (
            <View key={`${c.consentType}-${c.version}`} style={{ gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, color: colors.ink }}>{CONSENT_TYPE_LABEL[c.consentType] ?? c.consentType.replace(/_/g, " ")}</Text>
                <MutedText>{c.accepted && c.acceptedAt
                    ? `Accepted ${when(c.acceptedAt)} · v${c.version}`
                    : c.state === "withdrawn"
                      ? "You withdrew this. Nothing is shared under it."
                      : c.state === "older_version"
                        ? "A newer version is available. Review needed."
                        : c.isOptional
                          ? "Not shared"
                          : "Not yet recorded"}</MutedText>
              </View>
              <Badge tone={c.accepted ? "brand" : "neutral"}>
                {c.accepted ? "Accepted" : c.state === "withdrawn" ? "Withdrawn" : c.isOptional ? "Not shared" : "Outstanding"}
              </Badge>
            </View>
            <OptionalConsentControls row={c} organisationId={organisationId} patientId={userId} onChanged={() => void refresh()} />
            </View>
          ))
        )}
      </Card>

      <ConsentReceiptsCard receipts={receipts} error={receiptsError} />

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
          Under Nigeria&apos;s Data Protection Act, you can ask to see, correct, or erase the data we
          hold about you.
        </MutedText>
      </View>

      {requestsError && (
        <Card>
          <ErrorText>{requestsError}</ErrorText>
        </Card>
      )}
      <ExportRequestCard userId={userId} organisationId={organisationId} requests={exportRequests} blocked={requestsError !== null} onChanged={refresh} />
      <CorrectionRequestCard userId={userId} organisationId={organisationId} requests={correctionRequests} onChanged={refresh} />
      <DeletionRequestCard userId={userId} organisationId={organisationId} requests={deletionRequests} blocked={requestsError !== null} onChanged={refresh} />
    </ScrollView>
  );
}

function RequestList({ requests }: { requests: DataRightsRequest[] }) {
  const colors = useLegacyColors();
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
  const colors = useLegacyColors();
  const textInputStyle = useTextInputStyle();
  const { scheme } = useTheme();
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
          <TextInput keyboardAppearance={scheme} placeholderTextColor={placeholderColorFor(scheme)}
            value={recordDescription}
            onChangeText={setRecordDescription}
            placeholder="e.g. my date of birth, a blood pressure reading from last week"
            multiline
            numberOfLines={2}
            style={[textInputStyle, { minHeight: 50, textAlignVertical: "top" }]}
          />
          <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>What&apos;s wrong with it?</Text>
          <TextInput keyboardAppearance={scheme} placeholderTextColor={placeholderColorFor(scheme)} value={whatIsWrong} onChangeText={setWhatIsWrong} multiline numberOfLines={2} style={[textInputStyle, { minHeight: 50, textAlignVertical: "top" }]} />
          <Text style={{ fontSize: 12.5, fontWeight: "600", color: colors.ink }}>What should it say instead? (optional)</Text>
          <TextInput keyboardAppearance={scheme} placeholderTextColor={placeholderColorFor(scheme)} value={requestedChange} onChangeText={setRequestedChange} multiline numberOfLines={2} style={[textInputStyle, { minHeight: 50, textAlignVertical: "top" }]} />
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
