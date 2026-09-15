import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import {
  getLabOrderTestStatuses,
  setLabOrderTestStatus,
  type LabOrderTestStatusValue,
} from "@/lib/lab-orders";
import { uploadEcgReport, uploadLabResult } from "@/lib/labs";
import { testCodeLabel } from "@/lib/lab-catalogue-content";
import { colors, radius, spacing } from "@/ui/theme";
import { ErrorText, MutedText, SecondaryButton } from "@/ui/components";

const STATUS_OPTIONS: { value: LabOrderTestStatusValue; label: string }[] = [
  { value: "not_yet_done", label: "Not yet done" },
  { value: "done", label: "Done" },
  { value: "will_not_do", label: "Will not be doing" },
];

const TONE_BY_STATUS: Record<LabOrderTestStatusValue, { bg: string; border: string }> = {
  not_yet_done: { bg: "#FEF3C733", border: "#FDE68A" },
  done: { bg: colors.brandTint, border: colors.brand },
  will_not_do: { bg: colors.groupBg, border: colors.border },
};

interface CapturedPhoto {
  uri: string;
  mimeType: string;
  fileName: string;
}

/**
 * Per-test checklist for a multi-test lab order (e.g. Essential/Core
 * Screen), on the native app — the mobile counterpart to
 * apps/web/src/components/lab-order-test-checklist.tsx. One card per test
 * in the panel, each with its own done / not yet done / will not be doing
 * state (lab_order_test_status) and, once marked done, its own photo
 * upload slot scoped to that test — so a patient who got half the panel
 * done at one lab can say exactly which half.
 *
 * ecg_resting routes to uploadEcgReport (its own table,
 * ecg_report_documents) instead of the generic uploadLabResult — mirrors
 * the web component's EcgReportUpload branch. Never existed on mobile
 * before this: every prior native lab upload was a single freeform photo
 * with no order/test scoping at all (labs-screen.tsx).
 */
export function LabOrderTestChecklist({
  labOrderId,
  testCodes,
}: {
  labOrderId: string;
  testCodes: readonly string[];
}) {
  const [statusByCode, setStatusByCode] = useState<Record<string, LabOrderTestStatusValue>>({});
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadedCodes, setUploadedCodes] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    const result = await getLabOrderTestStatuses(labOrderId);
    if (result.ok) {
      const next: Record<string, LabOrderTestStatusValue> = {};
      for (const item of result.data) next[item.testCode] = item.status;
      setStatusByCode(next);
    }
  }, [labOrderId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function changeStatus(code: string, status: LabOrderTestStatusValue) {
    setStatusByCode((prev) => ({ ...prev, [code]: status }));
    const result = await setLabOrderTestStatus(labOrderId, code, status);
    if (!result.ok) {
      setError(result.error);
      refresh();
    }
  }

  async function pickAndUpload(code: string, source: "camera" | "library") {
    setError(null);
    const permission =
      source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError(
        source === "camera"
          ? "Camera access is off. Enable it in your phone's Settings to photograph a result."
          : "Photo access is off. Enable it in your phone's Settings to choose a photo."
      );
      return;
    }
    const result =
      source === "camera"
        ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const photo: CapturedPhoto = {
      uri: asset.uri,
      mimeType: asset.mimeType ?? "image/jpeg",
      fileName: asset.fileName ?? `result-${Date.now()}.jpg`,
    };

    setUploading(code);
    const uploadResult =
      code === "ecg_resting"
        ? await uploadEcgReport(photo, labOrderId)
        : await uploadLabResult(photo, code, labOrderId);
    setUploading(null);
    if (uploadResult.error) {
      setError(uploadResult.error);
      return;
    }
    setUploadedCodes((prev) => new Set(prev).add(code));
    setOpenCode(null);
    if ((statusByCode[code] ?? "not_yet_done") === "not_yet_done") {
      changeStatus(code, "done");
    }
  }

  return (
    <View style={{ gap: 8 }}>
      {testCodes.map((code) => {
        const status = statusByCode[code] ?? "not_yet_done";
        const isEcg = code === "ecg_resting";
        const isOpen = openCode === code;
        const tone = TONE_BY_STATUS[status];
        return (
          <View
            key={code}
            style={{
              borderWidth: 1,
              borderColor: tone.border,
              backgroundColor: tone.bg,
              borderRadius: radius.card,
              padding: spacing.card,
              gap: 8,
            }}
          >
            <Text style={{ fontSize: 14.5, fontWeight: "600", color: colors.ink }}>{testCodeLabel(code)}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {STATUS_OPTIONS.map((opt) => {
                const active = status === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => changeStatus(code, opt.value)}
                    style={({ pressed }) => ({
                      borderRadius: 999,
                      paddingVertical: 6,
                      paddingHorizontal: 12,
                      borderWidth: 1,
                      borderColor: active ? colors.brand : colors.border,
                      backgroundColor: active ? colors.brand : pressed ? colors.pressed : "transparent",
                    })}
                  >
                    <Text style={{ fontSize: 12, fontWeight: "600", color: active ? "#FFFFFF" : colors.ink }}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {status !== "will_not_do" &&
              (uploadedCodes.has(code) ? (
                <MutedText>{isEcg ? "ECG uploaded." : "Result uploaded."} Your care team will review it.</MutedText>
              ) : !isOpen ? (
                <SecondaryButton
                  title={isEcg ? "Upload this ECG" : "Upload this result"}
                  onPress={() => setOpenCode(code)}
                />
              ) : (
                <View style={{ gap: 6 }}>
                  {uploading === code ? (
                    <MutedText>Uploading…</MutedText>
                  ) : (
                    <>
                      <SecondaryButton title="Take a photo" onPress={() => pickAndUpload(code, "camera")} />
                      <SecondaryButton title="Choose from library" onPress={() => pickAndUpload(code, "library")} />
                    </>
                  )}
                </View>
              ))}
          </View>
        );
      })}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}
