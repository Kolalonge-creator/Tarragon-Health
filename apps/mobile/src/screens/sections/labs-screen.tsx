import { useState } from "react";
import { Image, Modal, ScrollView, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { uploadLabResult } from "@/lib/labs";
import { colors, radius, spacing } from "@/ui/theme";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/components";
import { WebViewScreen } from "@/screens/webview-screen";

interface CapturedPhoto {
  uri: string;
  mimeType: string;
  fileName: string;
}

/**
 * Native camera-capture lab result upload, the one native win §2.5 of
 * MOBILE_APP_SPEC.md calls out over a web file picker — everything else
 * (orders, results, trends) stays WebView, low weekly-touch frequency,
 * already built once on web. Self-book and facility selection are not part
 * of that WebView — both were suspended platform-wide by the 2026-08-03
 * self-arranged-fulfilment decision (no partner labs, no facility
 * directory) — so this screen must not promise either.
 */
export function LabsScreen() {
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [labDetailOpen, setLabDetailOpen] = useState(false);

  async function takePhoto() {
    setError(null);
    setSuccess(false);
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
    setSuccess(false);
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

  async function upload() {
    if (!photo) return;
    setUploading(true);
    setError(null);
    const result = await uploadLabResult(photo);
    setUploading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setPhoto(null);
    setSuccess(true);
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 14 }}>
      <View>
        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.ink }}>Labs &amp; results</Text>
        <MutedText>Photograph a result from any lab you've used, and we'll read it into your record.</MutedText>
      </View>

      <Card style={{ gap: 10 }}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink }}>Upload a result</Text>
        {photo ? (
          <>
            <Image
              source={{ uri: photo.uri }}
              style={{ width: "100%", height: 220, borderRadius: radius.control, backgroundColor: colors.border }}
              resizeMode="cover"
            />
            {error ? <ErrorText>{error}</ErrorText> : null}
            <PrimaryButton title="Upload this photo" onPress={upload} loading={uploading} />
            <SecondaryButton title="Retake" onPress={takePhoto} disabled={uploading} />
          </>
        ) : (
          <>
            <MutedText>You pay the lab directly; this is just how the result gets back to your record.</MutedText>
            {error ? <ErrorText>{error}</ErrorText> : null}
            {success ? <MutedText>Uploaded. Your care team will review it shortly.</MutedText> : null}
            <PrimaryButton title="Take a photo" onPress={takePhoto} />
            <SecondaryButton title="Choose from library" onPress={chooseFromLibrary} />
          </>
        )}
      </Card>

      <Card style={{ gap: 8 }}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink }}>Orders &amp; results</Text>
        <MutedText>See your past results, active requests, and trends in the full patient app.</MutedText>
        <SecondaryButton title="View orders & results" onPress={() => setLabDetailOpen(true)} />
      </Card>

      <Modal visible={labDetailOpen} animationType="slide" onRequestClose={() => setLabDetailOpen(false)}>
        <View style={{ flex: 1 }}>
          <View style={{ padding: spacing.screen, paddingTop: 56 }}>
            <SecondaryButton title="Close" onPress={() => setLabDetailOpen(false)} />
          </View>
          <WebViewScreen path="/patient/labs" />
        </View>
      </Modal>
    </ScrollView>
  );
}
