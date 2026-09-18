import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import {
  loadMyVerifiedDocuments,
  requestVerifiedDocument,
  getVerifiedDocumentPdfUrl,
  serviceProductCodeFor,
  VERIFIED_DOCUMENT_CREDIT_REQUIRED_MARKER,
  DOCUMENT_TYPE_LABEL,
  DOCUMENT_TYPE_OPTIONS,
  type VerifiedDocument,
  type VerifiedDocumentType,
} from "@/lib/verified-documents";
import { trySpendPlatformCreditForService } from "@/lib/platform-credit";
import { formatCareDate } from "@/lib/care";
import { PLATFORM_URL } from "@/lib/platform-url";
import { koboToNaira } from "@tarragon/shared";
import { colors, radius } from "@/ui/theme";
import { Badge, Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/components";

const textInputStyle = {
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radius.control,
  paddingHorizontal: 10,
  paddingVertical: 8,
  fontSize: 14,
  color: colors.ink,
} as const;

/**
 * Native "Verified documents" — mirrors apps/web/src/app/(dashboard)/
 * patient/verified-documents-card.tsx. Submits the request directly; if the
 * DB trigger rejects it for lack of a credit, this settles the *selected
 * document type's own* credit (serviceProductCodeFor(documentType) — each
 * type is priced and sold separately) in-app from the patient's platform
 * credit balance when that already covers the price, and retries — no
 * browser trip. Only a short balance (or a spend-level failure) falls back
 * to the system browser — buying a credit still requires Paystack checkout,
 * web-only (App Store 3.1.1).
 */
export function VerifiedDocumentsSection({
  patientId,
  organisationId,
}: {
  patientId: string;
  organisationId: string;
}) {
  const [documents, setDocuments] = useState<VerifiedDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [documentType, setDocumentType] = useState<VerifiedDocumentType>("fit_to_work");
  const [requestNote, setRequestNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [needsCredit, setNeedsCredit] = useState(false);
  const [creditShortfallKobo, setCreditShortfallKobo] = useState<number | null>(null);
  const [openingPdfId, setOpeningPdfId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await loadMyVerifiedDocuments(patientId);
    if (result.ok) setDocuments(result.data);
  }, [patientId]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    setNeedsCredit(false);
    setCreditShortfallKobo(null);
  }, [documentType]);

  async function submit() {
    setSubmitting(true);
    setError(null);
    setNeedsCredit(false);
    setCreditShortfallKobo(null);
    setSent(false);

    const input = {
      patientId,
      organisationId,
      documentType,
      requestNote: requestNote.trim() || undefined,
    };
    let result = await requestVerifiedDocument(input);

    if (!result.ok && result.error.includes(VERIFIED_DOCUMENT_CREDIT_REQUIRED_MARKER)) {
      const spend = await trySpendPlatformCreditForService(serviceProductCodeFor(documentType), patientId);
      if (spend.spent) {
        result = await requestVerifiedDocument(input);
      } else {
        setSubmitting(false);
        setNeedsCredit(true);
        setCreditShortfallKobo(spend.shortfallKobo ?? null);
        if (spend.error) setError(spend.error);
        return;
      }
    }

    setSubmitting(false);
    if (!result.ok) {
      if (result.error.includes(VERIFIED_DOCUMENT_CREDIT_REQUIRED_MARKER)) {
        setNeedsCredit(true);
      } else {
        setError(result.error);
      }
      return;
    }
    setRequestNote("");
    setSent(true);
    void refresh();
  }

  async function viewDocument(documentId: string) {
    setOpeningPdfId(documentId);
    const result = await getVerifiedDocumentPdfUrl(documentId);
    setOpeningPdfId(null);
    if (result.ok) {
      void WebBrowser.openBrowserAsync(result.data);
    } else {
      setError(result.error);
    }
  }

  return (
    <View style={{ gap: 10 }}>
      <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>Verified documents</Text>
      <MutedText>
        A doctor-attested letter or summary — a fit-to-work note, a travel health letter, a
        specialist referral and more — delivered as a signed PDF, no printing or courier needed.
      </MutedText>

      {needsCredit && (
        <Card style={{ gap: 8, backgroundColor: colors.brandTint }}>
          <Text style={{ fontSize: 13, color: colors.brandPressed }}>
            {creditShortfallKobo
              ? `You need ₦${koboToNaira(creditShortfallKobo).toLocaleString()} more platform credit for this document type.`
              : "Buy a credit for this document type to request it."}
          </Text>
          <SecondaryButton
            title="Buy a credit in the browser"
            onPress={() => void WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/care`)}
          />
        </Card>
      )}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {DOCUMENT_TYPE_OPTIONS.map((type) => {
          const selected = type === documentType;
          return (
            <Pressable
              key={type}
              onPress={() => setDocumentType(type)}
              style={{
                borderRadius: 999,
                paddingVertical: 7,
                paddingHorizontal: 12,
                backgroundColor: selected ? colors.brand : colors.groupBg,
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: "600", color: selected ? "#FFFFFF" : colors.ink }}>
                {DOCUMENT_TYPE_LABEL[type]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <TextInput
        value={requestNote}
        onChangeText={setRequestNote}
        placeholder="Details, e.g. employer name, or destination and travel dates (optional)"
        style={textInputStyle}
      />
      {error && <ErrorText>{error}</ErrorText>}
      {sent && <MutedText>Sent. A doctor will respond within 72 hours.</MutedText>}
      <PrimaryButton title="Request document" onPress={submit} loading={submitting} />

      {loading && <ActivityIndicator color={colors.brand} />}
      {documents.length > 0 && (
        <View style={{ gap: 10, marginTop: 4 }}>
          {documents.map((d) => (
            <Card key={d.id} style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <Text style={{ fontSize: 13.5, fontWeight: "600", color: colors.ink, flex: 1 }}>
                  {DOCUMENT_TYPE_LABEL[d.document_type as VerifiedDocumentType] ??
                    d.document_type.replace(/_/g, " ")}
                </Text>
                <Badge tone={d.status === "issued" ? "brand" : "neutral"}>
                  {d.status === "issued" ? "Issued" : d.status === "declined" ? "Declined" : "Requested"}
                </Badge>
              </View>
              {d.status === "declined" && d.declined_reason && <ErrorText>{d.declined_reason}</ErrorText>}
              {d.status === "issued" && d.valid_from && (
                <MutedText>
                  Valid from {formatCareDate(d.valid_from)}
                  {d.valid_until ? ` to ${formatCareDate(d.valid_until)}` : ""}
                </MutedText>
              )}
              {d.status === "issued" && (
                <SecondaryButton
                  title="View document"
                  onPress={() => void viewDocument(d.id)}
                  loading={openingPdfId === d.id}
                />
              )}
            </Card>
          ))}
        </View>
      )}
    </View>
  );
}
