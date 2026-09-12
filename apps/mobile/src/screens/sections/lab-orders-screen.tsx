import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, Linking, RefreshControl, ScrollView, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import {
  getAnalyteTrends,
  getLabCatalogue,
  getLabOrders,
  getLabResultInterpretations,
  getResultDocuments,
  isAwaitingResult,
  type AnalyteTrendItem,
  type LabCatalogueItem,
  type LabOrderItem,
  type LabOrderStatus,
  type LabResultInterpretationItem,
  type ResultDocumentItem,
  type ResultStatus,
} from "@/lib/lab-orders";
import { replaceLabResult } from "@/lib/labs";
import { resolveSubjectId } from "@/lib/acting";
import { supabase } from "@/lib/supabase";
import { colors, radius, spacing } from "@/ui/theme";
import {
  Card,
  ErrorText,
  GroupedList,
  GroupedListRow,
  MutedText,
  PrimaryButton,
  SecondaryButton,
  SectionLabel,
} from "@/ui/components";

interface CapturedPhoto {
  uri: string;
  mimeType: string;
  fileName: string;
}

/**
 * "I photographed the wrong result" — lets a patient swap the file on a
 * document they uploaded themselves, before anyone has reviewed it. Only
 * rendered by the result-documents list below, which already gates on
 * doc.source === "patient" && !doc.reviewedAt — the same condition the DB
 * itself enforces (20260912220345_lab_result_documents_patient_self_replace.sql).
 */
function ReplaceDocumentControl({ documentId, onReplaced }: { documentId: string; onReplaced: () => void }) {
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function takePhoto() {
    setError(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError("Camera access is off. Enable it in your phone's Settings to photograph a result.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setPhoto({
      uri: asset.uri,
      mimeType: asset.mimeType ?? "image/jpeg",
      fileName: asset.fileName ?? `result-${Date.now()}.jpg`,
    });
  }

  async function chooseFromLibrary() {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Photo access is off. Enable it in your phone's Settings to choose a photo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setPhoto({
      uri: asset.uri,
      mimeType: asset.mimeType ?? "image/jpeg",
      fileName: asset.fileName ?? `result-${Date.now()}.jpg`,
    });
  }

  async function replace() {
    if (!photo) return;
    setUploading(true);
    setError(null);
    const result = await replaceLabResult(documentId, photo);
    setUploading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setPhoto(null);
    setOpen(false);
    onReplaced();
  }

  if (!open) {
    return (
      <Text
        onPress={() => setOpen(true)}
        style={{ fontSize: 12.5, fontWeight: "600", color: colors.faint }}
      >
        Uploaded the wrong file? Replace it
      </Text>
    );
  }

  return (
    <View style={{ gap: 8 }}>
      {photo ? (
        <>
          <Image
            source={{ uri: photo.uri }}
            style={{ width: "100%", height: 160, borderRadius: radius.control, backgroundColor: colors.border }}
            resizeMode="cover"
          />
          {error ? <ErrorText>{error}</ErrorText> : null}
          <PrimaryButton title="Replace this upload" onPress={replace} loading={uploading} />
          <SecondaryButton title="Retake" onPress={takePhoto} disabled={uploading} />
        </>
      ) : (
        <>
          {error ? <ErrorText>{error}</ErrorText> : null}
          <PrimaryButton title="Take a photo" onPress={takePhoto} />
          <SecondaryButton title="Choose from library" onPress={chooseFromLibrary} />
          <SecondaryButton title="Cancel" onPress={() => setOpen(false)} />
        </>
      )}
    </View>
  );
}

/** Clinical-status tones (green/amber/red/blue/grey — a separate system from
 * brand colour, per CLAUDE.md) — same literal palette as
 * prevention-screen.tsx's TONE, colocated rather than shared since each
 * screen owns a small, different set of statuses. */
const TONE = {
  green: { bg: "#DCFCE7", text: "#15803D" },
  amber: { bg: "#FEF3C7", text: "#B45309" },
  red: { bg: "#FEE2E2", text: "#B91C1C" },
  blue: { bg: "#DBEAFE", text: "#1D4ED8" },
  grey: { bg: "#EEEEEC", text: "#57534E" },
} as const;

/** Mirrors lab-orders-list.tsx's LAB_ORDER_STATUS_BADGE. Self-arranged: the
 * states that matter to a patient are "we've written it, go when you can"
 * and "the result is in". Payment states are retained because the enum
 * still carries them for the dormant partner path. */
const ORDER_STATUS: Record<LabOrderStatus, { tone: keyof typeof TONE; label: string }> = {
  pending_payment: { tone: "amber", label: "Awaiting payment" },
  payment_confirmed: { tone: "blue", label: "Ready to take to a lab" },
  ordered: { tone: "blue", label: "Ready to take to a lab" },
  sample_collected: { tone: "blue", label: "Sample collected" },
  sample_rejected: { tone: "red", label: "Sample rejected (a new one is needed)" },
  processing: { tone: "blue", label: "In progress" },
  resulted: { tone: "green", label: "Results ready" },
  cancelled: { tone: "grey", label: "Cancelled" },
};

/** Mirrors result-status-badge.ts's RESULT_STATUS_BADGE. */
const RESULT_STATUS: Record<ResultStatus, { tone: keyof typeof TONE; label: string }> = {
  normal: { tone: "green", label: "Normal" },
  borderline: { tone: "amber", label: "Borderline" },
  indeterminate: { tone: "amber", label: "Needs repeat testing" },
  abnormal: { tone: "amber", label: "Needs follow-up" },
  critical: { tone: "red", label: "Needs urgent follow-up" },
};

function StatusPill({ tone, label }: { tone: keyof typeof TONE; label: string }) {
  const c = TONE[tone];
  return (
    <View style={{ backgroundColor: c.bg, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10, alignSelf: "flex-start" }}>
      <Text style={{ fontSize: 11, fontWeight: "600", color: c.text }}>{label}</Text>
    </View>
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

interface SectionState<T> {
  data: T | null;
  error: string | null;
}

const EMPTY_SECTION = { data: null, error: null } as const;

/**
 * Native "Labs & bookings" screen — replaces the WebView modal
 * labs-screen.tsx used to open at /patient/labs. Read/track only: test
 * requests, ML/clinician result interpretations, uploaded result documents
 * (with doctor review once sent), results-over-time trends, and a read-only
 * test catalogue. See lib/lab-orders.ts's module comment for exactly what
 * was deliberately left out (booking, facility selection, the paid
 * AI-summary consult CTA, the cookie-authenticated request PDF) and why.
 *
 * Resolves its own patient subject (self, or whoever the device is
 * currently "acting for") rather than taking a patientId prop — unlike
 * every other section screen, LabsScreen (its host) is rendered with no
 * props from home-shell.tsx, and that call site is out of scope for this
 * change.
 */
export function LabOrdersScreen() {
  const [patientId, setPatientId] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [orders, setOrders] = useState<SectionState<LabOrderItem[]>>(EMPTY_SECTION);
  const [interpretations, setInterpretations] = useState<SectionState<LabResultInterpretationItem[]>>(EMPTY_SECTION);
  const [documents, setDocuments] = useState<SectionState<ResultDocumentItem[]>>(EMPTY_SECTION);
  const [trends, setTrends] = useState<SectionState<AnalyteTrendItem[]>>(EMPTY_SECTION);
  const [catalogue, setCatalogue] = useState<SectionState<LabCatalogueItem[]>>(EMPTY_SECTION);

  const load = useCallback(async (subjectId: string) => {
    const [ordersRes, interpretationsRes, documentsRes, trendsRes, catalogueRes] = await Promise.all([
      getLabOrders(subjectId),
      getLabResultInterpretations(subjectId),
      getResultDocuments(subjectId),
      getAnalyteTrends(subjectId),
      getLabCatalogue(),
    ]);
    setOrders(ordersRes.ok ? { data: ordersRes.data, error: null } : { data: null, error: ordersRes.error });
    setInterpretations(
      interpretationsRes.ok ? { data: interpretationsRes.data, error: null } : { data: null, error: interpretationsRes.error }
    );
    setDocuments(documentsRes.ok ? { data: documentsRes.data, error: null } : { data: null, error: documentsRes.error });
    setTrends(trendsRes.ok ? { data: trendsRes.data, error: null } : { data: null, error: trendsRes.error });
    setCatalogue(catalogueRes.ok ? { data: catalogueRes.data, error: null } : { data: null, error: catalogueRes.error });
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        setResolveError("Not signed in.");
        setLoading(false);
        return;
      }
      const subjectId = await resolveSubjectId(user.id);
      if (cancelled) return;
      setPatientId(subjectId);
      await load(subjectId);
      if (!cancelled) setLoading(false);
    }
    init();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const onRefresh = useCallback(() => {
    if (!patientId) return;
    setRefreshing(true);
    load(patientId).finally(() => setRefreshing(false));
  }, [load, patientId]);

  function openDocument(url: string | null) {
    if (!url) return;
    Linking.openURL(url).catch(() => {});
  }

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  if (resolveError || !patientId) {
    return (
      <View style={{ flex: 1, padding: spacing.screen, backgroundColor: colors.background }}>
        <ErrorText>{resolveError ?? "Could not load your labs."}</ErrorText>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.screen, gap: 18 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
    >
      <View>
        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.ink }}>Labs & results</Text>
        <MutedText>Your test requests, results, and how your numbers are trending.</MutedText>
      </View>

      {/* Test requests */}
      <View style={{ gap: 10 }}>
        <SectionLabel>Your test requests</SectionLabel>
        {orders.error ? (
          <Card>
            <ErrorText>Could not load your test requests.</ErrorText>
          </Card>
        ) : !orders.data || orders.data.length === 0 ? (
          <Card>
            <MutedText>No test requests on file yet.</MutedText>
          </Card>
        ) : (
          <View style={{ gap: 10 }}>
            {orders.data.map((order) => {
              const badge = ORDER_STATUS[order.status];
              const awaiting = isAwaitingResult(order.status);
              return (
                <Card key={order.id} style={{ gap: 6 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <StatusPill tone={badge.tone} label={badge.label} />
                    {order.urgency === "urgent" && <StatusPill tone="red" label="Urgent" />}
                    {order.orderNumber ? (
                      <Text style={{ fontSize: 11, color: colors.faint }}>{order.orderNumber}</Text>
                    ) : null}
                  </View>
                  <Text style={{ fontSize: 14.5, fontWeight: "600", color: colors.ink }}>{order.panelBundleName}</Text>
                  <MutedText>
                    {order.testCount} test{order.testCount === 1 ? "" : "s"} · requested {formatDate(order.orderedAt)}
                  </MutedText>
                  {order.orderedByName ? <MutedText>Ordered by Dr. {order.orderedByName}</MutedText> : null}
                  {order.clinicalIndication ? <MutedText>Reason: {order.clinicalIndication}</MutedText> : null}
                  {order.preparationInstructions ? (
                    <View
                      style={{
                        backgroundColor: "#DBEAFE",
                        borderRadius: 10,
                        padding: 10,
                      }}
                    >
                      <Text style={{ fontSize: 12.5, color: "#1D4ED8" }}>{order.preparationInstructions}</Text>
                    </View>
                  ) : null}
                  {awaiting ? (
                    <MutedText>
                      You pay the lab directly, at whatever they charge. Take this order number with you, then use
                      &quot;Upload a result&quot; above once you have it.
                      {order.includesEcg ? " An ECG prints as its own separate document — upload that too." : ""}
                    </MutedText>
                  ) : null}
                </Card>
              );
            })}
          </View>
        )}
      </View>

      {/* Result documents */}
      <View style={{ gap: 10 }}>
        <SectionLabel>Result documents</SectionLabel>
        {documents.error ? (
          <Card>
            <ErrorText>Could not load your result documents.</ErrorText>
          </Card>
        ) : !documents.data || documents.data.length === 0 ? (
          <Card>
            <MutedText>No result documents yet.</MutedText>
          </Card>
        ) : (
          <View style={{ gap: 10 }}>
            {documents.data.map((doc) => (
              <Card key={doc.id} style={{ gap: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                  <Text style={{ flex: 1, fontSize: 14, fontWeight: "600", color: colors.ink }}>
                    {doc.originalFilename ?? "Result"}
                  </Text>
                  <StatusPill
                    tone={doc.interpretationSentAt ? "green" : "amber"}
                    label={doc.interpretationSentAt ? "Interpreted" : "Awaiting review"}
                  />
                </View>
                <MutedText>
                  {doc.source === "patient" ? "You uploaded this" : "Uploaded by your care team"} · {formatDate(doc.createdAt)}
                  {doc.note ? ` · ${doc.note}` : ""}
                </MutedText>
                {doc.signedUrl ? (
                  <Text
                    onPress={() => openDocument(doc.signedUrl)}
                    style={{ fontSize: 13, fontWeight: "600", color: colors.brand }}
                  >
                    {doc.isPdf ? "Open original (PDF) →" : "View original →"}
                  </Text>
                ) : (
                  <MutedText>File unavailable.</MutedText>
                )}
                {doc.interpretationSentAt && doc.patientInterpretation ? (
                  <View style={{ backgroundColor: colors.brandTint, borderRadius: 10, padding: 10, gap: 6 }}>
                    <Text style={{ fontSize: 13.5, color: colors.ink }}>{doc.patientInterpretation}</Text>
                    {doc.nextSteps ? (
                      <Text style={{ fontSize: 13.5, color: colors.ink }}>
                        <Text style={{ fontWeight: "600" }}>Next steps: </Text>
                        {doc.nextSteps}
                      </Text>
                    ) : null}
                    <MutedText>
                      {doc.reviewedByName ? `Reviewed by Dr. ${doc.reviewedByName}` : "Reviewed by your care team"}
                      {doc.reviewedAt ? ` · ${formatDate(doc.reviewedAt)}` : ""}
                    </MutedText>
                  </View>
                ) : (
                  <>
                    <MutedText>
                      Your care team hasn&apos;t reviewed this yet. We&apos;ll let you know here as soon as they have.
                    </MutedText>
                    {doc.aiSummaryStatus === "pending" ? (
                      <MutedText>Preparing an automatic summary…</MutedText>
                    ) : doc.aiSummaryStatus === "flagged" ? (
                      <View style={{ backgroundColor: TONE.amber.bg, borderRadius: 10, padding: 10 }}>
                        <Text style={{ fontSize: 12, fontWeight: "600", color: TONE.amber.text }}>
                          Automated summary. Not a medical opinion.
                        </Text>
                        <Text style={{ fontSize: 12.5, color: colors.ink, marginTop: 2 }}>
                          One or more values in this file fall outside the range printed on the report itself. Only a
                          doctor reviewing the full picture can tell you what it means.
                        </Text>
                      </View>
                    ) : doc.aiSummaryStatus === "ready" ? (
                      <MutedText>
                        The values in this file look consistent with the ranges printed on the report. A doctor
                        hasn&apos;t reviewed this yet.
                      </MutedText>
                    ) : null}
                    {doc.source === "patient" && !doc.reviewedAt ? (
                      <ReplaceDocumentControl documentId={doc.id} onReplaced={() => patientId && load(patientId)} />
                    ) : null}
                  </>
                )}
              </Card>
            ))}
          </View>
        )}
      </View>

      {/* Result interpretations */}
      <View style={{ gap: 10 }}>
        <SectionLabel>Your lab results</SectionLabel>
        {interpretations.error ? (
          <Card>
            <ErrorText>Could not load your lab results.</ErrorText>
          </Card>
        ) : !interpretations.data || interpretations.data.length === 0 ? (
          <Card>
            <MutedText>No result interpretations on file yet.</MutedText>
          </Card>
        ) : (
          <GroupedList>
            {interpretations.data.map((result) => {
              const badge = result.resultStatus ? RESULT_STATUS[result.resultStatus] : null;
              return (
                <GroupedListRow
                  key={result.id}
                  title={result.summary ?? "Results available, ask your care team for details."}
                  subtitle={formatDate(result.createdAt)}
                  trailing={badge ? <StatusPill tone={badge.tone} label={badge.label} /> : "none"}
                />
              );
            })}
          </GroupedList>
        )}
      </View>

      {/* Results over time */}
      <View style={{ gap: 10 }}>
        <SectionLabel>Your results over time</SectionLabel>
        {trends.error ? (
          <Card>
            <ErrorText>Could not load your lab results.</ErrorText>
          </Card>
        ) : !trends.data || trends.data.length === 0 ? (
          <Card>
            <MutedText>No lab results on file yet.</MutedText>
          </Card>
        ) : (
          <GroupedList>
            {trends.data.map((trend) => {
              const delta = trend.previousValue !== null ? trend.latestValue - trend.previousValue : null;
              const deltaLabel =
                delta === null
                  ? null
                  : delta === 0
                    ? "no change"
                    : `${delta > 0 ? "▲" : "▼"} ${Math.abs(Math.round(delta * 100) / 100)} since last test`;
              return (
                <GroupedListRow
                  key={trend.code}
                  title={trend.label}
                  subtitle={formatDate(trend.latestTakenAt)}
                  trailing={
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={{ fontSize: 14, fontWeight: "600", color: colors.ink }}>
                        {trend.latestValue}
                        {trend.latestUnit ? ` ${trend.latestUnit}` : ""}
                      </Text>
                      {deltaLabel ? <Text style={{ fontSize: 11.5, color: colors.faint }}>{deltaLabel}</Text> : null}
                    </View>
                  }
                />
              );
            })}
          </GroupedList>
        )}
        <MutedText>Each result, compared with your previous one — for tracking, not diagnosis.</MutedText>
      </View>

      {/* Lab tests catalogue */}
      <View style={{ gap: 10 }}>
        <SectionLabel>Lab tests</SectionLabel>
        {catalogue.error ? (
          <Card>
            <ErrorText>Could not load the lab catalogue.</ErrorText>
          </Card>
        ) : !catalogue.data || catalogue.data.length === 0 ? (
          <Card>
            <MutedText>No lab tests available yet.</MutedText>
          </Card>
        ) : (
          <GroupedList>
            {catalogue.data.map((bundle) => (
              <GroupedListRow
                key={bundle.id}
                title={bundle.name}
                subtitle={
                  bundle.description ?? `${bundle.testCount} test${bundle.testCount === 1 ? "" : "s"} included`
                }
                trailing="none"
              />
            ))}
          </GroupedList>
        )}
        <MutedText>
          Message your care team in the app and they&apos;ll write you a request to take to a laboratory of your
          choice. You pay the lab directly, at whatever they charge, and we take nothing on top.
        </MutedText>
      </View>
    </ScrollView>
  );
}
