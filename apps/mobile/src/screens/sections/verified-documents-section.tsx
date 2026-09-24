import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import {
  loadMyVerifiedDocuments,
  getVerifiedDocumentPdfUrl,
  DOCUMENT_TYPE_LABEL,
  type VerifiedDocument,
  type VerifiedDocumentType,
} from "@/lib/verified-documents";
import { formatCareDate } from "@/lib/care";
import { colors } from "@/ui/theme";
import { Badge, Card, ErrorText, MutedText, SecondaryButton } from "@/ui/components";

/**
 * Native "Verified documents" — retired from patient purchase 2026-09-24
 * (founder decision; see migration
 * 20260924055301_retire_senior_case_review_verified_documents_confidential_message.sql
 * and the matching change to
 * apps/web/src/app/(dashboard)/patient/verified-documents-card.tsx). There is
 * no request form here any more, only a read-only history so a patient with
 * a document already requested or issued before the retirement still has
 * somewhere to find and download it. Renders nothing once a patient has no
 * documents at all.
 */
export function VerifiedDocumentsSection({ patientId }: { patientId: string }) {
  const [documents, setDocuments] = useState<VerifiedDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openingPdfId, setOpeningPdfId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMyVerifiedDocuments(patientId).then((result) => {
      if (cancelled) return;
      if (result.ok) setDocuments(result.data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [patientId]);

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

  if (loading) return <ActivityIndicator color={colors.brand} />;
  if (documents.length === 0) return null;

  return (
    <View style={{ gap: 10 }}>
      <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>Verified documents</Text>
      {error && <ErrorText>{error}</ErrorText>}
      <View style={{ gap: 10 }}>
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
    </View>
  );
}
