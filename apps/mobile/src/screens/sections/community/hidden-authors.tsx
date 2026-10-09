import { useState } from "react";
import { View } from "react-native";
import type { MessageKey } from "@tarragon/i18n";
import { unhideAuthor } from "@/lib/community/api";
import type { HiddenAuthor } from "@/lib/community/model";
import { space } from "@/ui/design";
import { AppText, Button } from "@/ui/kit";
import { Section, Status, useCopy } from "./common";

/** "People you have hidden" in this group: made-up names only, each with a plain "Show again" button. They are never told. */
export function HiddenAuthors({ hidden, onChanged }: { hidden: readonly HiddenAuthor[]; onChanged: () => void }) {
  const copy = useCopy();
  const [note, setNote] = useState<MessageKey | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function show(id: string) {
    setNote(null);
    setBusyId(id);
    const result = await unhideAuthor(id).catch(() => null);
    setBusyId(null);
    if (result && result.ok) onChanged();
    else setNote(result ? result.key : "community.compose.refused.other");
  }

  return (
    <Section title={copy("community.group.hidden_title")}>
      {hidden.length === 0 ? (
        <AppText variant="body" tone="textMuted">
          {copy("community.group.hidden_none")}
        </AppText>
      ) : (
        <View style={{ gap: space.sm }}>
          {hidden.map((h) => (
            <View key={h.id} style={{ gap: space.xs }}>
              <AppText variant="bodyStrong">{h.handle}</AppText>
              <Button
                title={copy("community.group.unhide")}
                accessibilityHint={h.handle}
                variant="secondary"
                fullWidth={false}
                loading={busyId === h.id}
                onPress={() => void show(h.id)}
              />
            </View>
          ))}
        </View>
      )}
      <AppText variant="caption" tone="textMuted">
        {copy("community.group.hidden_note")}
      </AppText>
      <Status text={note ? copy(note) : null} />
    </Section>
  );
}
