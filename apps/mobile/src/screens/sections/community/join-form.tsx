import { useState } from "react";
import { View } from "react-native";
import type { MessageKey } from "@tarragon/i18n";
import { joinGroup } from "@/lib/community/api";
import { radii, space, useTheme } from "@/ui/design";
import { AppText, Button } from "@/ui/kit";
import { CheckRow, Status, useCopy } from "./common";

/**
 * Joining a group: the rules, an explanation of the made-up name, and two ticks the person must give themselves (the rules, and the
 * safety consent counsel approves). Nothing is sent until both are ticked. The group's own rules version goes with the request, so
 * rules that changed while the person was reading are caught by the database rather than silently agreed to.
 */
export function JoinForm({ groupId, rulesText, rulesVersion, onJoined }: { groupId: string; rulesText: string; rulesVersion: number; onJoined: () => void }) {
  const copy = useCopy();
  const { colors } = useTheme();
  const [rulesOk, setRulesOk] = useState(false);
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<MessageKey | null>(null);
  const [handle, setHandle] = useState<string | null>(null);

  async function submit() {
    if (pending) return;
    if (!rulesOk || !consent) {
      setMessage("community.join.refused.consent_needed");
      return;
    }
    setPending(true);
    setMessage(null);
    const result = await joinGroup({ groupId, rulesVersion, rulesAcknowledged: rulesOk, consent }).catch(() => null);
    setPending(false);
    if (result && result.ok) {
      setHandle(result.handle);
      onJoined();
    } else {
      setMessage(result ? result.key : "community.compose.refused.other");
    }
  }

  if (handle) {
    return (
      <View accessibilityRole="alert" style={{ backgroundColor: colors.brandTint, borderRadius: radii.md, padding: space.lg }}>
        <AppText variant="bodyStrong">{copy("community.group.your_name", { handle })}</AppText>
      </View>
    );
  }

  return (
    <View style={{ gap: space.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radii.lg, padding: space.lg }}>
      <AppText variant="title" heading>
        {copy("community.join.title")}
      </AppText>
      <View style={{ gap: space.xs }}>
        <AppText variant="bodyStrong" heading>
          {copy("community.group.rules_title")}
        </AppText>
        <AppText variant="body">{rulesText}</AppText>
      </View>
      <AppText variant="caption" tone="textMuted">
        {copy("community.join.handle_explainer")}
      </AppText>
      <CheckRow label={copy("community.join.rules_ack")} checked={rulesOk} onChange={setRulesOk} disabled={pending} />
      <View style={{ gap: space.sm }}>
        <AppText variant="bodyStrong" heading>
          {copy("community.join.consent_title")}
        </AppText>
        <AppText variant="body">{copy("community.join.consent")}</AppText>
        <CheckRow label={copy("community.join.consent_ack")} checked={consent} onChange={setConsent} disabled={pending} />
      </View>
      <Button title={pending ? copy("community.join.joining") : copy("community.join.confirm")} onPress={() => void submit()} disabled={!rulesOk || !consent} loading={pending} />
      <Status text={message ? copy(message) : null} />
    </View>
  );
}
