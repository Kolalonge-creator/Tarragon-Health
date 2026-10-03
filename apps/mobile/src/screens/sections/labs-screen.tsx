import { useState } from "react";
import { Image, ScrollView, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { RESULT_DOCUMENT_TEST_TYPE_OPTIONS, testTypeLabel, uploadLabResult } from "@/lib/labs";
import { radii, space, useTheme } from "@/ui/design";
import { AppText, Button, Card, Icon, InlineAlert, LegacySheet, ListItem, Screen, Sheet, useToast } from "@/ui/kit";
import { LabOrdersScreen } from "@/screens/sections/lab-orders-screen";

interface CapturedPhoto {
  uri: string;
  mimeType: string;
  fileName: string;
}

/**
 * Native camera-capture lab result upload, the one native win §2.5 of
 * MOBILE_APP_SPEC.md calls out over a web file picker. "Orders & results"
 * opens a genuine native screen (LabOrdersScreen) backed by real Supabase
 * queries. Self-book and facility selection are still out of scope for that
 * screen: both were suspended platform-wide by the 2026-08-03
 * self-arranged-fulfilment decision (no partner labs, no facility
 * directory), so it must not promise either.
 */
export function LabsScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const locale = asLocale(useUiLanguage());
  const tr = (key: MessageKey) => t(key, locale);

  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [testType, setTestType] = useState<string | null>(null);
  const [testTypePickerOpen, setTestTypePickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [labDetailOpen, setLabDetailOpen] = useState(false);

  async function takePhoto() {
    setError(null);
    setSuccess(false);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError(tr("labs.err.camera"));
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
    setSuccess(false);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError(tr("labs.err.photos"));
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

  async function upload() {
    if (!photo || uploading) return;
    if (!testType) {
      setError(tr("labs.err.choose_type"));
      return;
    }
    setUploading(true);
    setError(null);
    const result = await uploadLabResult(photo, testType);
    setUploading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setPhoto(null);
    setTestType(null);
    setSuccess(true);
    toast.show({ message: tr("labs.uploaded"), tone: "success" });
  }

  return (
    <Screen>
      <View style={{ gap: space.xs }}>
        <AppText variant="headline" heading>
          {tr("labs.title")}
        </AppText>
        <AppText variant="body" tone="textMuted">
          {tr("labs.subtitle")}
        </AppText>
      </View>

      <Card style={{ gap: space.md }}>
        <AppText variant="title" heading>
          {tr("labs.upload.title")}
        </AppText>
        {photo ? (
          <>
            <Image
              accessibilityLabel={tr("labs.photo.a11y")}
              source={{ uri: photo.uri }}
              style={{ width: "100%", height: 220, borderRadius: radii.md, backgroundColor: colors.surfaceMuted }}
              resizeMode="cover"
            />
            <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, overflow: "hidden" }}>
              <ListItem
                title={tr("labs.test_type.title")}
                subtitle={testType ? (testTypeLabel(testType) ?? undefined) : tr("labs.test_type.placeholder")}
                onPress={uploading ? undefined : () => setTestTypePickerOpen(true)}
              />
            </View>
            {error ? <InlineAlert tone="danger" message={error} /> : null}
            <Button title={tr("labs.upload.cta")} onPress={() => void upload()} loading={uploading} disabled={!testType} />
            <Button title={tr("labs.retake")} variant="secondary" onPress={() => void takePhoto()} disabled={uploading} />
          </>
        ) : (
          <>
            <AppText variant="body" tone="textMuted">
              {tr("labs.pay_note")}
            </AppText>
            {error ? <InlineAlert tone="danger" message={error} /> : null}
            {success ? <InlineAlert tone="info" message={tr("labs.uploaded")} /> : null}
            <Button title={tr("labs.take_photo")} onPress={() => void takePhoto()} />
            <Button title={tr("labs.choose_library")} variant="secondary" onPress={() => void chooseFromLibrary()} />
          </>
        )}
      </Card>

      <Card padded={false}>
        <ListItem icon="labs" title={tr("labs.orders.title")} subtitle={tr("labs.orders.body")} onPress={() => setLabDetailOpen(true)} />
      </Card>

      <LegacySheet visible={labDetailOpen} onClose={() => setLabDetailOpen(false)} closeLabel={tr("kit.close")}>
        <LabOrdersScreen />
      </LegacySheet>

      <Sheet visible={testTypePickerOpen} onClose={() => setTestTypePickerOpen(false)} title={tr("labs.picker.title")}>
        <AppText variant="body" tone="textMuted" style={{ marginBottom: space.md }}>
          {tr("labs.picker.body")}
        </AppText>
        <ScrollView style={{ maxHeight: 420 }}>
          {RESULT_DOCUMENT_TEST_TYPE_OPTIONS.map((option) => (
            <ListItem
              key={option.value}
              title={option.label}
              trailing={testType === option.value ? <Icon name="done" size={18} tone="brandText" /> : "chevron"}
              onPress={() => {
                setTestType(option.value);
                setTestTypePickerOpen(false);
              }}
            />
          ))}
        </ScrollView>
        <View style={{ marginTop: space.md }}>
          <Button title={tr("common.cancel")} variant="secondary" onPress={() => setTestTypePickerOpen(false)} />
        </View>
      </Sheet>
    </Screen>
  );
}
