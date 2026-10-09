import { useState } from "react";
import { View } from "react-native";
import type { MessageKey } from "@tarragon/i18n";
import { submitAppeal } from "@/lib/community/api";
import { APPEAL_MAX_CHARS, APPEAL_STATUS_KEY, SANCTION_KEY, type MyActions } from "@/lib/community/model";
import { space } from "@/ui/design";
import { AppText, Button, Field } from "@/ui/kit";
import { Section, Status, formatDate, useCopy } from "./common";

/** "Ask for a second look": the member says in their own words what they think was wrong. A different moderator decides. */
function AppealForm({ kind, targetId, onSent }: { kind: "removal" | "sanction"; targetId: string; onSent: () => void }) {
  const copy = useCopy();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<MessageKey | null>(null);
  const [sent, setSent] = useState(false);

  async function send() {
    if (pending || sent) return;
    setPending(true);
    setMessage(null);
    const result = await submitAppeal(kind, targetId, reason).catch(() => null);
    setPending(false);
    if (result && result.ok) {
      setSent(true);
      setMessage("community.appeals.sent");
      onSent();
    } else {
      setMessage(result ? result.key : "community.appeals.refused.other");
    }
  }

  return (
    <View style={{ gap: space.sm }}>
      <AppText variant="bodyStrong" heading>
        {copy("community.appeals.ask")}
      </AppText>
      <Field
        label={copy("community.appeals.reason_label")}
        value={reason}
        onChangeText={setReason}
        maxLength={APPEAL_MAX_CHARS}
        multiline
        numberOfLines={3}
        textAlignVertical="top"
        editable={!sent}
      />
      <Button title={copy("community.appeals.submit")} onPress={() => void send()} disabled={sent || reason.trim().length === 0} loading={pending} fullWidth={false} />
      <Status text={message ? copy(message) : null} />
    </View>
  );
}

/**
 * Removed posts and access changes, with an appeal form where one is still possible. Deliberately shows no moderator name and never the
 * text of a removed post: only the group's name, what happened and when.
 */
export function AppealsView({ actions, onChanged }: { actions: MyActions; onChanged: () => void }) {
  const copy = useCopy();
  const { removed_posts: removed, sanctions } = actions;
  if (removed.length === 0 && sanctions.length === 0) {
    return (
      <AppText variant="body" tone="textMuted">
        {copy("community.appeals.empty")}
      </AppText>
    );
  }
  return (
    <View style={{ gap: space.xl }}>
      {removed.length > 0 ? (
        <View style={{ gap: space.md }}>
          <AppText variant="title" heading>
            {copy("community.appeals.removed_title")}
          </AppText>
          {removed.map((r) => (
            <Section key={r.post_id} title={copy("community.appeals.removed_line", { group: r.group_name })}>
              {r.removed_at ? (
                <AppText variant="caption" tone="textMuted">
                  {formatDate(r.removed_at)}
                </AppText>
              ) : null}
              {r.appeal_status ? <AppText variant="bodyStrong">{copy(APPEAL_STATUS_KEY[r.appeal_status])}</AppText> : null}
              {r.can_appeal ? <AppealForm kind="removal" targetId={r.post_id} onSent={onChanged} /> : null}
            </Section>
          ))}
        </View>
      ) : null}
      {sanctions.length > 0 ? (
        <View style={{ gap: space.md }}>
          <AppText variant="title" heading>
            {copy("community.appeals.sanctions_title")}
          </AppText>
          {sanctions.map((s) => (
            <Section key={s.sanction_id} title={`${copy(SANCTION_KEY[s.kind])}${s.group_name ? ` (${s.group_name})` : ""}`}>
              <AppText variant="caption" tone="textMuted">
                {formatDate(s.starts_at)}
              </AppText>
              {s.overturned ? <AppText variant="bodyStrong">{copy("community.appeals.overturned_note")}</AppText> : null}
              {s.appeal_status ? <AppText variant="bodyStrong">{copy(APPEAL_STATUS_KEY[s.appeal_status])}</AppText> : null}
              {s.can_appeal ? <AppealForm kind="sanction" targetId={s.sanction_id} onSent={onChanged} /> : null}
            </Section>
          ))}
        </View>
      ) : null}
    </View>
  );
}
