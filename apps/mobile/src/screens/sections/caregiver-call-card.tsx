import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { activeCallPasses, cancelCallInvite, inviteToCall, loadCallCaregivers, type CallActionResult, type CallCaregivers } from "@/lib/care-circle/call-invites";
import { space } from "@/ui/design";
import { AppText, Button, Card, InlineAlert } from "@/ui/kit";

const STATUS_KEYS: Record<CallCaregivers["passes"][number]["state"], MessageKey> = {
  invited: "consult.cg.status_invited",
  accepted: "consult.cg.status_accepted",
  declined: "consult.cg.status_declined",
  removed: "consult.cg.status_removed",
};

/**
 * CGJ: the patient invites ONE person from their Care Circle to this call (per call, never a standing right). The same database
 * functions as the web room; the person answers in their own app and joins from the web browser (this app has no call SDK).
 * NOT run on a real phone. Renders nothing until the list has loaded, and nothing when the person is not on this call.
 */
export function CaregiverCallCard({ encounterId }: { encounterId: string }) {
  const locale = asLocale(useUiLanguage());
  const tr = (key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params);
  const [list, setList] = useState<CallCaregivers | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await loadCallCaregivers(encounterId);
    if (r.ok) setList(r.data);
  }, [encounterId]);
  useEffect(() => {
    void load();
    // The answer, "in the call now" and a removal arrive while the screen is open, so the card re-reads while the call is live. It stops
    // with the screen; the room screen above polls the same way.
    const id = setInterval(() => void load(), 15_000);
    return () => clearInterval(id);
  }, [load]);

  const run = (action: () => Promise<CallActionResult>, done?: string) => {
    setBusy(true);
    setNote(null);
    void action().then(async (r) => {
      setNote(r === "ok" ? (done ?? null) : r === "not_allowed" ? tr("consult.cg.error_not_allowed") : tr("consult.cg.error"));
      await load();
      setBusy(false);
    });
  };

  if (!list || (!list.live && list.passes.length === 0)) return null;
  const active = activeCallPasses(list);

  return (
    <Card style={{ gap: space.md }}>
      <AppText variant="title" heading>
        {tr("consult.cg.title")}
      </AppText>
      <AppText variant="body">{tr("consult.cg.body")}</AppText>
      {list.passes.map((p) => (
        <View key={p.pass_id} style={{ gap: space.sm }}>
          <AppText variant="body" accessibilityLiveRegion="polite">{`${p.name ?? p.relationship} (${p.relationship}): ${tr(STATUS_KEYS[p.state])}`}</AppText>
          {p.state === "invited" || p.state === "accepted" ? (
            <Button title={tr("consult.cg.cancel")} variant="secondary" disabled={busy} onPress={() => run(() => cancelCallInvite(p.pass_id))} />
          ) : null}
        </View>
      ))}
      {list.live && active.length < list.max
        ? list.invitable.length === 0 && list.passes.length === 0
          ? <AppText variant="body" tone="textMuted">{tr("consult.cg.none")}</AppText>
          : list.invitable.map((m) => (
              <Button
                key={m.member_id}
                title={tr("consult.cg.invite_button", { name: m.name, relationship: m.relationship })}
                disabled={busy}
                onPress={() => run(() => inviteToCall(encounterId, m.member_id), tr("consult.cg.sent"))}
              />
            ))
        : null}
      {note ? <InlineAlert tone="info" message={note} /> : null}
    </Card>
  );
}
