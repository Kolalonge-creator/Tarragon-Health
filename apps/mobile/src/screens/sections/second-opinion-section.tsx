import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, TextInput, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import {
  acceptSecondOpinionReferral,
  getReferralLetterUrl,
  loadMySecondOpinionRequests,
  loadRecommendedReferral,
  loadShareableResults,
  loadSecondOpinionPriceKobo,
  SECOND_OPINION_CREDIT_REQUIRED_MARKER,
  SECOND_OPINION_MAX_FILES,
  SECOND_OPINION_MAX_SHARED_RESULTS,
  submitSecondOpinionWithMaterial,
  type RecommendedReferral,
  type SecondOpinionRequestWithAnswerer,
  type ShareableResult,
} from "@/lib/second-opinion";
import { formatCareDate } from "@/lib/care";
import { loadCanAddReviewNote } from "@/lib/review-note";
import { formatDoctorName } from "@/lib/doctor-name";
import { PLATFORM_URL } from "@/lib/platform-url";
import { useLegacyColors, useTextInputStyle, useTheme, placeholderColorFor } from "@/ui/design";
import { Badge, Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";
import { AppText } from "@/ui/kit/AppText";

/** The referral a doctor recommended with the answer: accept it, then open the letter. */
function RecommendedReferralBlock({ requestId, referralId, onChanged }: { requestId: string; referralId: string; onChanged: () => void }) {
  const [referral, setReferral] = useState<RecommendedReferral | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await loadRecommendedReferral(referralId);
    if (r.ok) setReferral(r.data);
  }, [referralId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!referral) return null;
  const accept = async () => {
    setBusy(true);
    setError(null);
    const r = await acceptSecondOpinionReferral(requestId);
    setBusy(false);
    if (!r.ok) {
      setError("Could not accept the referral. Try again.");
      return;
    }
    await load();
    onChanged();
  };
  const openLetter = async () => {
    const url = await getReferralLetterUrl(referral.id);
    if (url.ok) void WebBrowser.openBrowserAsync(url.data);
    else setError("Could not open the letter. Try again.");
  };
  return (
    <View style={{ gap: 6, marginTop: 6 }}>
      <AppText variant="bodyStrong">Your doctor suggests seeing a specialist</AppText>
      {referral.reason && <MutedText>{referral.reason}</MutedText>}
      {referral.status === "draft" ? (
        <>
          <MutedText>Accepting shares the relevant part of your record with the specialist and gives you a referral letter.</MutedText>
          <PrimaryButton title="Accept this referral" onPress={accept} loading={busy} />
        </>
      ) : (
        <SecondaryButton title="Open your referral letter" onPress={openLetter} />
      )}
      {error && <ErrorText>{error}</ErrorText>}
    </View>
  );
}

/**
 * Native "Second opinion", a Members-only extra (an extra 5,000 naira, read from the product row). Mirrors apps/web/src/app/(dashboard)/
 * patient/second-opinion-request.tsx. A Member submits the request; if they have no credit yet the DB trigger says so and the app sends
 * them to the system browser to pay (Paystack checkout stays web-only, App Store 3.1.1). Someone who is not a Member is told, in plain
 * words, that a second opinion is part of Membership; the server refuses the purchase for them, and no price is shown.
 */
export function SecondOpinionSection({ patientId, organisationId }: { patientId: string; organisationId: string }) {
  const colors = useLegacyColors();
  const textInputStyle = useTextInputStyle();
  const { scheme } = useTheme();
  const [requests, setRequests] = useState<SecondOpinionRequestWithAnswerer[]>([]);
  const [loading, setLoading] = useState(true);
  const [existingDiagnosisOrResult, setExistingDiagnosisOrResult] = useState("");
  const [sourceDescription, setSourceDescription] = useState("");
  const [specificQuestion, setSpecificQuestion] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [needsCredit, setNeedsCredit] = useState(false);
  const [isMember, setIsMember] = useState<boolean | null>(null);
  const [priceKobo, setPriceKobo] = useState<number | null>(null);
  const [shareable, setShareable] = useState<ShareableResult[]>([]);
  const [sharedIds, setSharedIds] = useState<string[]>([]);
  const [photos, setPhotos] = useState<{ uri: string; mimeType: string }[]>([]);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    void loadShareableResults().then((r) => {
      if (r.ok) setShareable(r.data);
    });
  }, []);

  // A report saved as a PDF (or any photo already in Files): the system picker copies it into the app's cache so it can be read.
  async function addFile() {
    if (photos.length >= SECOND_OPINION_MAX_FILES) {
      setError(`Add at most ${SECOND_OPINION_MAX_FILES} files`);
      return;
    }
    setError(null);
    const picked = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
      copyToCacheDirectory: true,
      multiple: false,
    });
    const asset = picked.canceled ? null : picked.assets[0];
    if (!asset) return;
    if (typeof asset.size === "number" && asset.size > 8 * 1024 * 1024) {
      setError("That file is over 8 MB. Choose a smaller one.");
      return;
    }
    setPhotos((cur) => [...cur, { uri: asset.uri, mimeType: asset.mimeType ?? "application/pdf" }]);
  }

  const toggleShared = (id: string) =>
    setSharedIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= SECOND_OPINION_MAX_SHARED_RESULTS ? cur : [...cur, id]));

  async function addPhoto(source: "camera" | "library") {
    if (photos.length >= SECOND_OPINION_MAX_FILES) {
      setError(`Add at most ${SECOND_OPINION_MAX_FILES} files`);
      return;
    }
    setError(null);
    const permission =
      source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError(
        source === "camera"
          ? "Camera access is off. Enable it in your phone's Settings to photograph a report."
          : "Photo access is off. Enable it in your phone's Settings to choose a photo."
      );
      return;
    }
    const picked =
      source === "camera" ? await ImagePicker.launchCameraAsync({ quality: 0.7 }) : await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
    const asset = picked.canceled ? null : picked.assets[0];
    if (!asset) return;
    setPhotos((cur) => [...cur, { uri: asset.uri, mimeType: asset.mimeType ?? "image/jpeg" }]);
  }

  const refresh = useCallback(async () => {
    const result = await loadMySecondOpinionRequests(patientId);
    if (result.ok) setRequests(result.data);
  }, [patientId]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    let alive = true;
    void loadCanAddReviewNote().then((member) => {
      if (!alive) return;
      setIsMember(member);
      if (member) void loadSecondOpinionPriceKobo().then((kobo) => alive && setPriceKobo(kobo));
    });
    return () => {
      alive = false;
    };
  }, []);

  async function submit() {
    if (existingDiagnosisOrResult.trim().length === 0) {
      setError("Describe the result or diagnosis you'd like a second opinion on");
      return;
    }
    setSubmitting(true);
    setError(null);
    setNeedsCredit(false);
    setSent(false);
    setWarning(null);

    const result = await submitSecondOpinionWithMaterial({
      patientId,
      organisationId,
      existingDiagnosisOrResult: existingDiagnosisOrResult.trim(),
      sourceDescription: sourceDescription.trim() || undefined,
      specificQuestion: specificQuestion.trim() || undefined,
      sharedLabResultIds: sharedIds,
      photos,
    });

    setSubmitting(false);
    if (!result.ok) {
      if (result.error.includes(SECOND_OPINION_CREDIT_REQUIRED_MARKER)) {
        setNeedsCredit(true);
      } else {
        setError(result.error);
      }
      return;
    }
    setExistingDiagnosisOrResult("");
    setSourceDescription("");
    setSpecificQuestion("");
    setSharedIds([]);
    setPhotos([]);
    setSent(true);
    const notes: string[] = [];
    if (!result.data.resultsAttached) notes.push("We could not attach the results you chose, so the doctor will review your description only.");
    if (result.data.filesFailed > 0) notes.push(`${result.data.filesFailed} of your files could not be uploaded.`);
    setWarning(notes.length > 0 ? notes.join(" ") : null);
    void refresh();
  }

  return (
    <View style={{ gap: 10 }}>
      <AppText variant="bodyLargeStrong">Second opinion</AppText>
      <MutedText>
        Already have a result or diagnosis from somewhere else? A doctor on your care team reviews
        it and writes back their own assessment, no visit needed.
      </MutedText>

      {isMember === false && (
        <Card style={{ gap: 8, backgroundColor: colors.brandTint }}>
          <AppText variant="body" tone="brandText">A second opinion is part of Membership.</AppText>
          <SecondaryButton
            title="Join Membership"
            onPress={() => void WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/membership`)}
          />
        </Card>
      )}

      {isMember === true && priceKobo !== null && (
        <MutedText>A second opinion is an extra for Members: ₦{(priceKobo / 100).toLocaleString("en-NG")}.</MutedText>
      )}

      {needsCredit && isMember === true && (
        <Card style={{ gap: 8, backgroundColor: colors.brandTint }}>
          <AppText variant="body" tone="brandText">
            Pay for your second opinion to send this request.
          </AppText>
          <SecondaryButton
            title="Pay in the browser"
            onPress={() => void WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/care`)}
          />
        </Card>
      )}

      <TextInput keyboardAppearance={scheme} placeholderTextColor={placeholderColorFor(scheme)}
        value={existingDiagnosisOrResult}
        onChangeText={setExistingDiagnosisOrResult}
        placeholder="e.g. My GP diagnosed me with X and suggested Y. I'd like another doctor's view."
        multiline
        numberOfLines={3}
        style={[textInputStyle, { minHeight: 70, textAlignVertical: "top" }]}
      />
      <TextInput keyboardAppearance={scheme} placeholderTextColor={placeholderColorFor(scheme)}
        value={sourceDescription}
        onChangeText={setSourceDescription}
        placeholder="Where is this from? (optional)"
        style={textInputStyle}
      />
      <TextInput keyboardAppearance={scheme} placeholderTextColor={placeholderColorFor(scheme)}
        value={specificQuestion}
        onChangeText={setSpecificQuestion}
        placeholder="A specific question? (optional)"
        style={textInputStyle}
      />
      {shareable.length > 0 && (
        <View style={{ gap: 6 }}>
          <AppText variant="bodyStrong">Show the doctor your Tarragon results (optional)</AppText>
          <MutedText>Only the results you pick are shown, only to the doctor reviewing this request.</MutedText>
          {shareable.map((r) => {
            const on = sharedIds.includes(r.id);
            return (
              <SecondaryButton
                key={r.id}
                title={`${on ? "✓ " : ""}${r.panelCode === "membership_annual" ? "Annual blood test" : "Lab result"} · ${formatCareDate(r.receivedAt)} · ${r.valueCount} ${r.valueCount === 1 ? "value" : "values"}`}
                onPress={() => toggleShared(r.id)}
              />
            );
          })}
        </View>
      )}
      <View style={{ gap: 6 }}>
        <AppText variant="bodyStrong">Reports from elsewhere (optional)</AppText>
        <MutedText>PDF or photo, up to {SECOND_OPINION_MAX_FILES} files of 8 MB each. Only the doctor reviewing this request sees them.</MutedText>
        {photos.length > 0 && <MutedText>{photos.length} {photos.length === 1 ? "file" : "files"} added</MutedText>}
        <SecondaryButton title="Choose a PDF or file" onPress={() => void addFile()} />
        <SecondaryButton title="Take a photo" onPress={() => void addPhoto("camera")} />
        <SecondaryButton title="Choose from your photos" onPress={() => void addPhoto("library")} />
        {photos.length > 0 && <SecondaryButton title="Remove files" onPress={() => setPhotos([])} />}
      </View>
      {error && <ErrorText>{error}</ErrorText>}
      {sent && <MutedText>Sent. A doctor will answer here within 72 hours.</MutedText>}
      {warning && <MutedText>{warning}</MutedText>}
      {isMember !== false && <PrimaryButton title="Send for review" onPress={submit} loading={submitting} />}

      {loading && <ActivityIndicator color={colors.brand} />}
      {requests.length > 0 && (
        <View style={{ gap: 10, marginTop: 4 }}>
          {requests.map((r) => {
            const answered = r.status === "answered" || r.status === "closed";
            return (
              <Card key={r.id} style={{ gap: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <AppText variant="bodyStrong" style={{ flex: 1 }}>
                    {r.existing_diagnosis_or_result}
                  </AppText>
                  <Badge tone={answered ? "brand" : "neutral"}>
                    {answered ? "Answered" : "With your care team"}
                  </Badge>
                </View>
                {answered && r.answer && (
                  <>
                    <AppText variant="body">{r.answer}</AppText>
                    {r.answerer && r.answered_at && (
                      <MutedText>
                        Answered by {formatDoctorName(r.answerer.full_name)} on {formatCareDate(r.answered_at)}
                      </MutedText>
                    )}
                    {r.referral_id && (
                      <RecommendedReferralBlock requestId={r.id} referralId={r.referral_id} onChanged={() => void refresh()} />
                    )}
                  </>
                )}
              </Card>
            );
          })}
        </View>
      )}
    </View>
  );
}
