import { useState } from "react";
import { View } from "react-native";
import type { MessageKey } from "@tarragon/i18n";
import { reportPost } from "@/lib/community/api";
import { REPORT_REASONS, reportReasonKey, type ReportReason } from "@/lib/community/model";
import { radii, space, useTheme } from "@/ui/design";
import { AppText, Button, Chip, Field } from "@/ui/kit";
import { Status, useCopy } from "./common";

/** Report a post: one reason (required) and an optional note. The answer is always a calm thank-you or a plain "already reported". */
export function ReportForm({ postId }: { postId: string }) {
  const copy = useCopy();
  const { colors } = useTheme();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<MessageKey | null>(null);
  const [done, setDone] = useState(false);

  async function send() {
    if (!reason || pending || done) return;
    setPending(true);
    setMessage(null);
    const result = await reportPost(postId, reason, detail).catch(() => null);
    setPending(false);
    if (result && result.ok) {
      setDone(true);
      setMessage(result.key);
    } else {
      setMessage(result ? result.key : "community.compose.refused.other");
    }
  }

  return (
    <View
      accessibilityLabel={copy("community.report.title")}
      style={{ gap: space.md, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: radii.md, padding: space.md }}
    >
      <AppText variant="bodyStrong" heading>
        {copy("community.report.title")}
      </AppText>
      <View accessibilityRole="radiogroup" style={{ gap: space.sm, alignItems: "flex-start" }}>
        {REPORT_REASONS.map((r) => (
          <Chip key={r} label={copy(reportReasonKey(r))} selected={reason === r} onPress={() => !done && setReason(r)} />
        ))}
      </View>
      <Field label={copy("community.report.detail")} value={detail} onChangeText={setDetail} multiline numberOfLines={2} textAlignVertical="top" editable={!done} />
      <Button title={copy("community.report.submit")} onPress={() => void send()} disabled={!reason || done} loading={pending} />
      <Status text={message ? copy(message) : null} />
    </View>
  );
}
