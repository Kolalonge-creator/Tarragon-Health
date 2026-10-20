import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, Linking, View } from "react-native";
import { summariseDecisions, type FieldDecision, type SuggestedField } from "@tarragon/shared";
import { t, type MessageKey } from "@tarragon/i18n";
import { confirmFields, loadDocumentDetail, rejectReading, type DocumentDetail, type DocumentListItem } from "@/lib/document-capture/capture";
import { formatPassportDate } from "@/lib/passport-format";
import { space, useTheme } from "@/ui/design";
import { AppText, Button, Card, Field, InlineAlert } from "@/ui/kit";
import { ToggleRow } from "@/screens/sections/passport-parts";

interface Props {
  doc: DocumentListItem;
  onBack: () => void;
  /** After a confirm or a rejection, so the list shows the new state. */
  onChanged: (message: string) => void;
}

/**
 * One document: the photo, and (when a reading is waiting) the per-field confirm screen. Every suggested detail is off until the person turns it on,
 * each can be edited first, and only what is kept is sent. Nothing read from the photo is part of the record until then, and "None of these are
 * right" leaves the photo and nothing else. Read live: neither the suggestions nor the photo link are ever kept on the phone.
 */
export function DocumentView({ doc, onBack, onChanged }: Props) {
  const { colors } = useTheme();
  const [state, setState] = useState<{ kind: "loading" } | { kind: "failed" } | { kind: "ready"; detail: DocumentDetail }>({ kind: "loading" });
  const [decisions, setDecisions] = useState<Record<string, FieldDecision>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    const detail = await loadDocumentDetail(doc.id);
    setState(detail ? { kind: "ready", detail } : { kind: "failed" });
  }, [doc.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const detail = state.kind === "ready" ? state.detail : null;
  const reviewing = doc.ocrState === "suggested" && detail !== null;
  const list = Object.values(decisions);
  const summary = detail ? summariseDecisions(detail.fields, list) : null;

  const setField = (field: SuggestedField, patch: Partial<FieldDecision>) =>
    setDecisions((prev) => ({
      ...prev,
      [field.key]: { key: field.key, accept: patch.accept ?? prev[field.key]?.accept ?? false, value: patch.value ?? prev[field.key]?.value },
    }));

  async function confirm() {
    if (!detail) return;
    setMessage(null);
    setBusy(true);
    const r = await confirmFields(doc.id, detail.fields, list);
    setBusy(false);
    if (r.ok) {
      onChanged(r.kept === 1 ? t("mpass.doc.kept_one") : t("mpass.doc.kept_many", "en", { count: String(r.kept) }));
      return;
    }
    setMessage(
      r.reason === "none_accepted" ? t("mpass.doc.none_accepted") : r.reason === "offline" ? t("mpass.needs_connection") : r.reason === "not_waiting" ? t("mpass.doc.not_waiting") : t("mpass.save_failed")
    );
  }

  async function reject() {
    setMessage(null);
    setBusy(true);
    const r = await rejectReading(doc.id);
    setBusy(false);
    if (r.ok) onChanged(t("mpass.doc.rejected_done"));
    else setMessage(r.reason === "offline" ? t("mpass.needs_connection") : t("mpass.save_failed"));
  }

  return (
    <View style={{ gap: space.lg }}>
      <Button title={t("mpass.doc.back")} variant="ghost" fullWidth={false} onPress={onBack} />
      <AppText variant="headline" heading>
        {t(`passport.documents.type.${doc.documentType}` as MessageKey)}
      </AppText>
      <AppText variant="caption" tone="textMuted">
        {formatPassportDate(doc.createdAt)}
        {doc.filename ? ` · ${doc.filename}` : ""}
      </AppText>

      {state.kind === "loading" ? <ActivityIndicator color={colors.brand} accessibilityLabel={t("mpass.loading")} /> : null}
      {state.kind === "failed" ? (
        <View style={{ gap: space.md }}>
          <InlineAlert tone="danger" message={t("mpass.doc.detail_failed")} />
          <Button title={t("common.try_again")} variant="secondary" onPress={() => void load()} />
        </View>
      ) : null}

      {detail ? (
        <>
          {detail.isPdf ? (
            detail.photoUrl ? (
              <Button title={t("mpass.doc.open_pdf")} variant="secondary" onPress={() => void Linking.openURL(detail.photoUrl ?? "")} />
            ) : (
              <InlineAlert tone="info" message={t("mpass.doc.photo_none")} />
            )
          ) : detail.photoUrl ? (
            <Image source={{ uri: detail.photoUrl }} accessibilityLabel={t("mpass.doc.open_photo")} resizeMode="contain" style={{ width: "100%", height: 280, backgroundColor: colors.surfaceMuted, borderRadius: 12 }} />
          ) : (
            <InlineAlert tone="info" message={t("mpass.doc.photo_none")} />
          )}

          {message ? <InlineAlert tone="danger" message={message} /> : null}

          {reviewing ? (
            <>
              <AppText variant="title" heading>
                {t("passport.documents.review_title")}
              </AppText>
              <AppText tone="textMuted">{t("passport.documents.review_help")}</AppText>
              {detail.fields.map((f) => (
                <Card key={f.key} style={{ gap: space.sm }}>
                  <ToggleRow
                    label={t("passport.documents.keep_aria", "en", { label: f.label })}
                    hint={t(`passport.documents.confidence.${f.confidence}` as MessageKey)}
                    value={decisions[f.key]?.accept ?? false}
                    onChange={(v) => setField(f, { accept: v })}
                  />
                  <Field label={t("passport.documents.value_aria", "en", { label: f.label })} defaultValue={f.value} editable={!busy} onChangeText={(v) => setField(f, { value: v })} maxLength={400} />
                  {f.unit ? (
                    <AppText variant="caption" tone="textMuted">
                      {f.unit}
                    </AppText>
                  ) : null}
                </Card>
              ))}
              {summary && summary.accepted === 0 ? <AppText variant="caption" tone="textMuted">{t("mpass.doc.none_accepted")}</AppText> : null}
              <Button title={t("passport.documents.confirm", "en", { count: String(summary?.accepted ?? 0) })} loading={busy} disabled={!summary?.canConfirm} onPress={() => void confirm()} />
              <Button title={t("passport.documents.reject")} variant="secondary" disabled={busy} onPress={() => void reject()} />
              {summary && summary.dropped > 0 ? (
                <AppText variant="caption" tone="textMuted">
                  {t("passport.documents.dropped_note", "en", { count: String(summary.dropped) })}
                </AppText>
              ) : null}
            </>
          ) : doc.ocrState === "confirmed" ? (
            <>
              <AppText variant="bodyStrong">{t("passport.documents.state.confirmed")}</AppText>
              {detail.fields.map((f) => (
                <AppText key={f.key}>
                  {f.label}: {f.value}
                  {f.unit ? ` ${f.unit}` : ""}
                </AppText>
              ))}
            </>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
