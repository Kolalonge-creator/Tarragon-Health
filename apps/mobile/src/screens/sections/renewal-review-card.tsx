import { useEffect, useState } from "react";
import { View } from "react-native";
import type { MessageKey } from "@tarragon/i18n";
import { space } from "@/ui/design";
import { AppText, Button, Card, Field, InlineAlert } from "@/ui/kit";
import { addReviewNote, loadCanAddReviewNote } from "@/lib/review-note";

type Tr = (key: MessageKey, params?: Record<string, string | number>) => string;

/**
 * "Prescription renewals are decided at your monthly call." A Member is told so plainly and can leave an optional note for the next
 * review. Someone who is not a Member is told renewal is part of Membership. Nothing here requests a renewal.
 */
export function RenewalReviewCard({ tr }: { tr: Tr }) {
  const [isMember, setIsMember] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void loadCanAddReviewNote().then((v) => {
      if (alive) setIsMember(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (isMember === null) return null;

  if (!isMember) {
    return (
      <Card style={{ gap: space.xs }}>
        <AppText variant="body">{tr("meds.review.free")}</AppText>
      </Card>
    );
  }

  async function send() {
    setBusy(true);
    setError(null);
    const result = await addReviewNote(note);
    setBusy(false);
    if (result.ok) {
      setSent(true);
      setNote("");
      setOpen(false);
    } else {
      setError(tr("meds.review.error"));
    }
  }

  return (
    <Card style={{ gap: space.sm }}>
      <AppText variant="body">{tr("meds.review.member_info")}</AppText>
      {sent ? <InlineAlert tone="info" message={tr("meds.review.sent")} /> : null}
      {open ? (
        <View style={{ gap: space.sm }}>
          <Field label={tr("meds.review.note_label")} hint={tr("meds.review.note_hint")} value={note} onChangeText={setNote} multiline maxLength={500} />
          {error ? <InlineAlert tone="danger" message={error} /> : null}
          <Button title={tr("meds.review.send")} onPress={() => void send()} loading={busy} disabled={note.trim().length === 0} />
        </View>
      ) : (
        <Button title={tr("meds.review.add_note")} variant="secondary" onPress={() => { setSent(false); setOpen(true); }} />
      )}
    </Card>
  );
}

