import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AccessibilityInfo, Image, View } from "react-native";
import * as Crypto from "expo-crypto";
import { t, type MessageKey } from "@tarragon/i18n";
import { DOCUMENT_CAPTURE_TYPES, saveDocument, type DocumentCaptureType, type ReadingOutcome } from "@/lib/document-capture/capture";
import { NO_TRIM, rotate, stepTrim, type Edge, type Rotation, type Trim } from "@/lib/document-capture/crop";
import { chooseDocumentPhoto, choosePdf, renderPreview, takeDocumentPhoto, type PickedImage } from "@/lib/document-capture/pick";
import { prepareDocumentPhoto } from "@/lib/document-capture/prepare";
import { space, useTheme } from "@/ui/design";
import { AppText, Button, Card, Chip, InlineAlert } from "@/ui/kit";

interface Props {
  userId: string;
  organisationId: string;
  onCancel: () => void;
  /** Called once the document is saved, with what to tell the person about reading. */
  onSaved: (reading: ReadingOutcome) => void;
}

type Step =
  | { kind: "choose" }
  | { kind: "crop"; image: PickedImage }
  | { kind: "saving" }
  /** The picture is prepared and kept in memory; the save did not go through, so the person can try again without choosing it again. */
  | { kind: "retry"; bytes: Uint8Array; mime: "image/jpeg" | "application/pdf"; filename: string };

const EDGES: Edge[] = ["top", "bottom", "left", "right"];

/**
 * Add a document: what it is, then a photo or a PDF, then turn and trim, then save. Every step can be left. The picture is only changed when the
 * person presses Use this photo, and only the prepared copy (turned, trimmed, at most 1600 pixels, location data removed) is ever uploaded.
 *
 * Saving needs a connection and says so; the prepared picture stays on this screen for a retry. Nothing is queued in the background, because a
 * document that looks saved but is not is worse than one the person knows still has to be sent.
 */
export function AddFlow({ userId, organisationId, onCancel, onSaved }: Props) {
  const [type, setType] = useState<DocumentCaptureType>("prescription");
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [message, setMessage] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  // One id per document: a retry after a lost answer reuses it, so the upload and the row are never made twice.
  const attemptId = useRef<string>(Crypto.randomUUID());

  async function pick(run: () => Promise<Awaited<ReturnType<typeof takeDocumentPhoto>>>) {
    setMessage(null);
    const r = await run();
    if (r.kind === "picked") setStep({ kind: "crop", image: r.image });
    else if (r.kind === "denied") setMessage({ tone: "info", text: t("mpass.doc.permission_denied") });
    else if (r.kind === "failed") setMessage({ tone: "danger", text: t("mpass.doc.pick_failed") });
  }

  async function pickPdf() {
    setMessage(null);
    const r = await choosePdf();
    if (r.kind === "picked") await save(r.bytes, "application/pdf", r.filename);
    else if (r.kind === "too_big") setMessage({ tone: "danger", text: t("passport.documents.too_big") });
    else if (r.kind === "not_pdf") setMessage({ tone: "danger", text: t("mpass.doc.not_pdf") });
    else if (r.kind === "failed") setMessage({ tone: "danger", text: t("mpass.doc.pick_failed") });
  }

  async function save(bytes: Uint8Array, mime: "image/jpeg" | "application/pdf", filename: string) {
    setMessage(null);
    setStep({ kind: "saving" });
    const r = await saveDocument({ userId, organisationId, attemptId: attemptId.current, type, bytes, mime, filename });
    if (r.ok) {
      onSaved(r.reading);
      return;
    }
    setStep({ kind: "retry", bytes, mime, filename });
    setMessage({
      tone: r.reason === "offline" ? "info" : "danger",
      text: r.reason === "offline" ? t("mpass.needs_connection") : t("passport.documents.upload_failed"),
    });
  }

  if (step.kind === "saving") {
    return (
      <Card style={{ gap: space.md, alignItems: "center" }}>
        <ActivityIndicator accessibilityLabel={t("mpass.doc.saving")} />
        <AppText>{t("mpass.doc.saving")}</AppText>
      </Card>
    );
  }

  if (step.kind === "retry") {
    return (
      <Card style={{ gap: space.md }}>
        {message ? <InlineAlert tone={message.tone} message={message.text} /> : null}
        <AppText tone="textMuted">{t("mpass.doc.keep_on_screen")}</AppText>
        <Button title={t("common.try_again")} onPress={() => void save(step.bytes, step.mime, step.filename)} />
        <Button title={t("mpass.doc.cancel")} variant="ghost" onPress={onCancel} />
      </Card>
    );
  }

  if (step.kind === "crop") {
    return (
      <CropStep
        image={step.image}
        onUse={async (rotation, trim) => {
          setMessage(null);
          setStep({ kind: "saving" });
          const prepared = await prepareDocumentPhoto(step.image.uri, step.image.width, step.image.height, { rotation, trim });
          if (!prepared.ok) {
            setStep({ kind: "crop", image: step.image });
            setMessage({ tone: "danger", text: prepared.reason === "too_big" ? t("passport.documents.too_big") : t("mpass.doc.unreadable") });
            return;
          }
          await save(prepared.bytes, "image/jpeg", step.image.filename.replace(/\.[a-z0-9]+$/i, "") + ".jpg");
        }}
        onChooseAnother={() => setStep({ kind: "choose" })}
        message={message}
      />
    );
  }

  return (
    <Card style={{ gap: space.md }}>
      <AppText variant="title" heading>
        {t("passport.documents.add_title")}
      </AppText>
      {message ? <InlineAlert tone={message.tone} message={message.text} /> : null}
      <AppText variant="label" tone="textMuted">
        {t("passport.documents.type_label")}
      </AppText>
      <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        {DOCUMENT_CAPTURE_TYPES.map((v) => (
          <Chip key={v} label={t(`passport.documents.type.${v}` as MessageKey)} selected={type === v} onPress={() => setType(v)} />
        ))}
      </View>
      <Button title={t("mpass.doc.take_photo")} onPress={() => void pick(takeDocumentPhoto)} />
      <Button title={t("mpass.doc.choose_photo")} variant="secondary" onPress={() => void pick(chooseDocumentPhoto)} />
      <Button title={t("mpass.doc.choose_pdf")} variant="secondary" onPress={() => void pickPdf()} />
      <Button title={t("mpass.doc.cancel")} variant="ghost" onPress={onCancel} />
    </Card>
  );
}

function CropStep({
  image,
  onUse,
  onChooseAnother,
  message,
}: {
  image: PickedImage;
  onUse: (rotation: Rotation, trim: Trim) => void;
  onChooseAnother: () => void;
  message: { tone: "info" | "danger"; text: string } | null;
}) {
  const { colors } = useTheme();
  const [rotation, setRotation] = useState<Rotation>(0);
  const [trim, setTrim] = useState<Trim>(NO_TRIM);
  const [width, setWidth] = useState(0);
  const [preview, setPreview] = useState<{ uri: string; width: number; height: number } | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const latest = useRef(0);

  // The preview is a small turned copy, redrawn when the turn changes. A newer request wins; a failed one leaves the photo usable as it is.
  useEffect(() => {
    const mine = ++latest.current;
    setPreviewFailed(false);
    void renderPreview(image.uri, image.width, image.height, rotation).then((p) => {
      if (mine !== latest.current) return;
      if (p) setPreview(p);
      else setPreviewFailed(true);
    });
  }, [image, rotation]);

  const aspect = preview ? preview.height / preview.width : image.height / image.width;
  const boxHeight = Math.min(width * aspect, 360);
  const boxWidth = Math.min(width, boxHeight / aspect);
  const pct = (n: number) => `${n}%` as const;

  const change = (edge: Edge, direction: 1 | -1) => {
    const next = stepTrim(trim, edge, direction);
    setTrim(next);
    AccessibilityInfo.announceForAccessibility(t("mpass.doc.trim_value", "en", { edge: t(`mpass.doc.edge.${edge}` as MessageKey), percent: String(next[edge]) }));
  };

  return (
    <Card style={{ gap: space.md }}>
      <AppText variant="title" heading>
        {t("mpass.doc.crop_title")}
      </AppText>
      <AppText tone="textMuted">{t("mpass.doc.crop_help")}</AppText>
      {message ? <InlineAlert tone={message.tone} message={message.text} /> : null}

      <View onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))} style={{ alignItems: "center" }}>
        {preview && width > 0 ? (
          <View accessible accessibilityRole="image" accessibilityLabel={t("mpass.doc.preview_aria")} style={{ width: boxWidth, height: boxHeight, backgroundColor: colors.surfaceMuted }}>
            <Image source={{ uri: preview.uri }} style={{ width: boxWidth, height: boxHeight }} resizeMode="contain" />
            {/* What will be trimmed away is shaded; the part that stays is left clear. */}
            <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, height: pct(trim.top), backgroundColor: "rgba(0,0,0,0.45)" }} />
            <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: pct(trim.bottom), backgroundColor: "rgba(0,0,0,0.45)" }} />
            <View pointerEvents="none" style={{ position: "absolute", left: 0, top: pct(trim.top), bottom: pct(trim.bottom), width: pct(trim.left), backgroundColor: "rgba(0,0,0,0.45)" }} />
            <View pointerEvents="none" style={{ position: "absolute", right: 0, top: pct(trim.top), bottom: pct(trim.bottom), width: pct(trim.right), backgroundColor: "rgba(0,0,0,0.45)" }} />
          </View>
        ) : previewFailed ? (
          <InlineAlert tone="info" message={t("mpass.doc.preview_failed")} />
        ) : (
          <ActivityIndicator accessibilityLabel={t("mpass.loading")} />
        )}
      </View>

      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button title={t("mpass.doc.turn_left")} variant="secondary" fullWidth={false} onPress={() => setRotation((r) => rotate(r, "left"))} />
        <Button title={t("mpass.doc.turn_right")} variant="secondary" fullWidth={false} onPress={() => setRotation((r) => rotate(r, "right"))} />
      </View>

      {EDGES.map((edge) => {
        const name = t(`mpass.doc.edge.${edge}` as MessageKey);
        return (
          <View key={edge} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
            <Button title="-" accessibilityLabel={t("mpass.doc.trim_less", "en", { edge: name.toLowerCase() })} variant="secondary" fullWidth={false} disabled={trim[edge] === 0} onPress={() => change(edge, -1)} />
            <AppText accessibilityLiveRegion="polite" style={{ flex: 1, textAlign: "center" }}>
              {t("mpass.doc.trim_value", "en", { edge: name, percent: String(trim[edge]) })}
            </AppText>
            <Button title="+" accessibilityLabel={t("mpass.doc.trim_more", "en", { edge: name.toLowerCase() })} variant="secondary" fullWidth={false} onPress={() => change(edge, 1)} />
          </View>
        );
      })}

      <Button title={t("mpass.doc.use_photo")} onPress={() => onUse(rotation, trim)} />
      <Button title={t("mpass.doc.choose_another")} variant="ghost" onPress={onChooseAnother} />
    </Card>
  );
}

