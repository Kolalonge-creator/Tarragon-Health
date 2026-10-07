import { useCallback, useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@tarragon/i18n";
import { connectionLabel, isListable, validationLabel, type Tables } from "@tarragon/shared";
import { postDeviceEcgResult } from "@/lib/api";
import { readLatestWatchEcg } from "@/lib/healthkit-ecg";
import { supabase } from "@/lib/supabase";
import { PhotoReadingScreen } from "@/screens/photo-reading-screen";
import { useLegacyColors } from "@/ui/design";
import { Card, MutedText, SecondaryButton, SectionLabel } from "@/ui/legacy-kit";

type CatalogRow = Tables<"device_catalog">;

/**
 * S70 (Module 18) additions to the Devices tab: manual entry first, the photo-of-a-screen route, the recommended list and, on
 * iPhone, sharing the watch's own ECG result. Everything here is optional: a device is never required (Module 18 safety rule).
 */
export function DevicesExtras({ beneficiaryProfileId }: { beneficiaryProfileId?: string }) {
  const colors = useLegacyColors();
  const [photoOpen, setPhotoOpen] = useState(false);
  const [catalogue, setCatalogue] = useState<CatalogRow[] | null>(null);
  const [reviewCount, setReviewCount] = useState(0);
  const [ecgMessage, setEcgMessage] = useState<string | null>(null);
  const [ecgBusy, setEcgBusy] = useState(false);
  const [ecgNeedsSymptomCheck, setEcgNeedsSymptomCheck] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await supabase.from("device_catalog").select("*").eq("active", true).eq("clinically_reviewed", true).order("category").order("display_order");
      setCatalogue((data ?? []).filter(isListable));
    } catch {
      setCatalogue([]);
    }
    try {
      const { data } = await supabase.rpc("my_device_review_status");
      setReviewCount(typeof data === "number" ? data : 0);
    } catch {
      setReviewCount(0);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function shareEcg() {
    setEcgBusy(true);
    setEcgMessage(null);
    setEcgNeedsSymptomCheck(false);
    const latest = await readLatestWatchEcg();
    if (latest.status === "unavailable") {
      setEcgMessage(t("devices.ecg.unavailable"));
    } else if (latest.status === "none") {
      setEcgMessage(t("devices.ecg.none"));
    } else {
      const sent = await postDeviceEcgResult({
        classification: latest.mapped.classification,
        provider: "apple_watch",
        device_result_text: latest.mapped.deviceResultText,
        recorded_at: latest.recordedAt,
      });
      setEcgMessage(sent.success ? t("devices.ecg.sent") : (sent.error ?? t("devices.ecg.unavailable")));
      // Chest pain, fainting or breathlessness go to the existing emergency guidance, never to a rhythm interpretation here.
      if (sent.success && sent.review) setEcgNeedsSymptomCheck(true);
      void load();
    }
    setEcgBusy(false);
  }

  return (
    <View style={{ gap: 14 }}>
      <Card style={{ gap: 8, backgroundColor: colors.groupBg }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Ionicons name="hand-left-outline" size={16} color={colors.muted} />
          <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink }}>{t("devices.manual_first")}</Text>
        </View>
        <SecondaryButton title={t("devices.photo.title")} onPress={() => setPhotoOpen(true)} />
      </Card>

      {reviewCount > 0 ? (
        <Card style={{ gap: 4 }}>
          <MutedText>{t("devices.review.notice")}</MutedText>
        </Card>
      ) : null}

      {Platform.OS === "ios" ? (
        <Card style={{ gap: 8 }}>
          <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>{t("devices.ecg.title")}</Text>
          <SecondaryButton title={ecgBusy ? "…" : t("devices.ecg.share")} onPress={() => void shareEcg()} />
          {ecgMessage ? <MutedText>{ecgMessage}</MutedText> : null}
          {ecgNeedsSymptomCheck ? <MutedText>{t("devices.ecg.symptoms_question")}</MutedText> : null}
        </Card>
      ) : null}

      <View style={{ gap: 10 }}>
        <SectionLabel>{t("devices.recommended.title")}</SectionLabel>
        <MutedText>{t("devices.recommended.intro")}</MutedText>
        {catalogue && catalogue.length === 0 ? <MutedText>{t("devices.recommended.empty")}</MutedText> : null}
        {(catalogue ?? []).map((d) => (
          <Card key={d.id} style={{ gap: 4 }}>
            <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>{d.device_name}</Text>
            {d.vendor_name ? <MutedText>{d.vendor_name}</MutedText> : null}
            {validationLabel(d.validation_standard) ? <MutedText>{validationLabel(d.validation_standard)}</MutedText> : null}
            <MutedText>{connectionLabel(d.bluetooth_via)}</MutedText>
            {d.distributor_name ? <MutedText>{t("devices.recommended.distributor", "en", { name: d.distributor_name })}</MutedText> : null}
          </Card>
        ))}
      </View>

      <PhotoReadingScreen visible={photoOpen} beneficiaryProfileId={beneficiaryProfileId} onClose={() => setPhotoOpen(false)} />
    </View>
  );
}
