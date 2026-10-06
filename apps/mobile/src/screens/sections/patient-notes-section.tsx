import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { loadNoteIndex, loadReleasedNotes, requestNoteCorrection, requestNoteRelease } from "@/lib/patient-notes";
import { useUiLanguage } from "@/lib/ui-language";
import {
  amendmentLabelKey,
  canRequestRelease,
  checkCorrectionText,
  CORRECTION_MAX_CHARS,
  CORRECTION_MIN_CHARS,
  correctionStateKey,
  visibleSections,
  type NoteIndexItem,
  type ReleasedNote,
} from "@/lib/written-questions/notes";
import { placeholderColorFor, useLegacyColors, useTextInputStyle, useTheme } from "@/ui/design";
import { Badge, Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

function lagosDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

/**
 * "Your notes" (S22). The patient sees which signed notes exist and their
 * release state; a note opens in full only once a clinician has released it
 * (nothing is released automatically). Patients never see drafts: the two
 * database functions used here return signed notes only. A correction request
 * sits beside the note; nothing is ever deleted. The health passport and
 * timeline only label that a note exists, so this is the one place the
 * content shows.
 */
export function PatientNotesSection() {
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const tr: Translate = useCallback((key, params) => t(key, locale, params), [locale]);
  const [index, setIndex] = useState<NoteIndexItem[]>([]);
  const [released, setReleased] = useState<ReleasedNote[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [i, r] = await Promise.all([loadNoteIndex(), loadReleasedNotes()]);
    if (i.ok) setIndex(i.data);
    if (r.ok) setReleased(r.data);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const releasedById = new Map(released.map((n) => [n.id, n]));

  return (
    <View style={{ gap: 10 }}>
      <Text accessibilityRole="header" style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>
        {tr("notes.title")}
      </Text>
      <MutedText>{tr("notes.intro")}</MutedText>
      {loading ? <ActivityIndicator color={colors.brand} /> : null}
      {!loading && index.length === 0 ? <MutedText>{tr("notes.empty")}</MutedText> : null}
      {index.map((item) => (
        <NoteRow key={item.id} item={item} note={releasedById.get(item.id) ?? null} tr={tr} onChanged={refresh} />
      ))}
    </View>
  );
}

function NoteRow({
  item,
  note,
  tr,
  onChanged,
}: {
  item: NoteIndexItem;
  note: ReleasedNote | null;
  tr: Translate;
  onChanged: () => Promise<void>;
}) {
  const colors = useLegacyColors();
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState(false);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);

  async function request() {
    setBusy(true);
    setErrorKey(null);
    const res = await requestNoteRelease(item.id);
    setBusy(false);
    if (!res.ok) {
      setErrorKey("wq.error.generic");
      return;
    }
    setAsked(true);
    await onChanged();
  }

  const showRequested = (item.releaseState === "requested" || asked) && item.releaseState !== "released";

  return (
    <Card style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <Text style={{ flex: 1, fontSize: 14, fontWeight: "600", color: colors.ink }}>
          {tr("notes.signed_on", { date: lagosDate(item.signedAt) })}
        </Text>
        {item.releaseState === "released" ? <Badge tone="brand">{tr("notes.released_badge")}</Badge> : null}
      </View>

      {item.releaseState === "declined" && item.withholdReason && !asked ? (
        <MutedText>{tr("notes.declined", { reason: item.withholdReason })}</MutedText>
      ) : null}
      {showRequested ? <MutedText>{tr("notes.requested")}</MutedText> : null}
      {canRequestRelease(item.releaseState) && !asked ? (
        <SecondaryButton title={tr("notes.request")} onPress={() => void request()} loading={busy} />
      ) : null}
      {errorKey ? <ErrorText>{tr(errorKey)}</ErrorText> : null}

      {item.releaseState === "released" && note ? <ReleasedNoteBody note={note} tr={tr} onChanged={onChanged} /> : null}
    </Card>
  );
}

function ReleasedNoteBody({ note, tr, onChanged }: { note: ReleasedNote; tr: Translate; onChanged: () => Promise<void> }) {
  const colors = useLegacyColors();
  const textInputStyle = useTextInputStyle();
  const { scheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);

  async function sendCorrection() {
    if (!checkCorrectionText(text)) {
      setErrorKey("wq.error.length");
      return;
    }
    setBusy(true);
    setErrorKey(null);
    const res = await requestNoteCorrection(note.id, text);
    setBusy(false);
    if (!res.ok) {
      setErrorKey("wq.error.generic");
      return;
    }
    setText("");
    setOpen(false);
    setSent(true);
    await onChanged();
  }

  return (
    <View style={{ gap: 10 }}>
      {note.amendmentKind ? (
        <View style={{ gap: 2, alignItems: "flex-start" }}>
          <Badge tone="neutral">{tr(amendmentLabelKey(note.amendmentKind))}</Badge>
          {note.amendmentReason ? <MutedText>{tr("notes.amendment.reason", { reason: note.amendmentReason })}</MutedText> : null}
          <MutedText>{tr("notes.amended", { date: lagosDate(note.signedAt) })}</MutedText>
        </View>
      ) : null}

      {visibleSections(note).map((s) => (
        <View key={s.key} style={{ gap: 2 }}>
          <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink }}>{tr(s.key)}</Text>
          <Text style={{ fontSize: 14, lineHeight: 21, color: colors.ink }}>{s.text}</Text>
        </View>
      ))}

      {note.corrections.map((c) => (
        <View key={c.id} style={{ gap: 2, borderLeftWidth: 3, borderLeftColor: colors.border, paddingLeft: 10 }}>
          <Text style={{ fontSize: 13.5, color: colors.ink }}>{c.requestText}</Text>
          <MutedText>{tr(correctionStateKey(c.state))}</MutedText>
          {c.response ? <MutedText>{tr("notes.correction.reply", { text: c.response })}</MutedText> : null}
        </View>
      ))}

      {sent ? <MutedText>{tr("notes.correction.sent")}</MutedText> : null}

      {open ? (
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{tr("notes.correction.label")}</Text>
          <TextInput
            keyboardAppearance={scheme}
            placeholderTextColor={placeholderColorFor(scheme)}
            value={text}
            onChangeText={setText}
            accessibilityLabel={tr("notes.correction.label")}
            multiline
            maxLength={CORRECTION_MAX_CHARS}
            style={[textInputStyle, { minHeight: 80, textAlignVertical: "top" }]}
          />
          {errorKey ? (
            <ErrorText>{errorKey === "wq.error.length" ? tr("wq.error.length", { min: CORRECTION_MIN_CHARS }) : tr(errorKey)}</ErrorText>
          ) : null}
          <PrimaryButton title={tr("notes.correction.send")} onPress={() => void sendCorrection()} loading={busy} />
        </View>
      ) : (
        <SecondaryButton title={tr("notes.correction.cta")} onPress={() => setOpen(true)} />
      )}
    </View>
  );
}
