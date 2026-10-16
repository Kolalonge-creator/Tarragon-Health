import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import type { MessageKey } from "@tarragon/i18n";
import { space } from "@/ui/design";
import { AppText, Button, Card, Chip, InlineAlert, PressableScale } from "@/ui/kit";
import {
  choosePharmacy, loadOptions, loadWaiting, newCode, newVisitCode, sentGroups, toggleSelection, unsent, withdraw,
  type ActionResult, type CollectionGroup, type PharmacyOption, type WaitingItem,
} from "@/lib/pharmacy-collection";

type Tr = (key: MessageKey, params?: Record<string, string | number>) => string;

const lagosDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" }) : "";
const where = (g: { pharmacyName: string | null; locationName: string | null }) => [g.pharmacyName, g.locationName].filter(Boolean).join(", ");

/**
 * Collect your medicines (S28e, OQ-277). Medicines the care team prescribed are chosen, together or one by one, for a verified pharmacy; once sent, the
 * collection code is shown here for the visit. The database decides everything (who may, which pharmacy, the code, the lock, the go-live guard), so while
 * collection is not open, or when nothing is waiting, this card shows nothing at all. Collection only: no delivery, no payment, no prices, no chat.
 */
export function PharmacyCollectCard({ tr }: { tr: Tr }) {
  const [items, setItems] = useState<WaitingItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [off, setOff] = useState(false);
  const [stale, setStale] = useState(false);
  const loaded = useRef(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [options, setOptions] = useState<PharmacyOption[] | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "warn"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const result = await loadWaiting();
    if (result.ok) {
      loaded.current = true;
      setItems(result.data);
      setFailed(false);
      setStale(false);
      setOff(false);
    } else if (result.off) {
      loaded.current = false;
      setOff(true);
      setItems(null);
    } else {
      // A failed refresh keeps what is already on screen (it may hold the code she just asked for) and says it may be out of date; only a first
      // load that fails shows the plain failure.
      setFailed(!loaded.current);
      setStale(loaded.current);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const say = (r: ActionResult, ok: MessageKey) =>
    setNotice(r.ok ? { tone: "info", text: tr(ok) } : { tone: "warn", text: r.notice === "failed" ? tr("pharmmob.failed") : tr(`pharmcollect.notice.${r.notice}` as MessageKey) });

  async function openChooser() {
    const first = selected[0];
    if (!first || busy) return;
    setBusy(true);
    setNotice(null);
    const result = await loadOptions(first);
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "warn", text: result.off ? tr("pharmmob.off") : tr("pharmmob.load_failed") });
      return;
    }
    setOptions(result.data);
    setChoosing(true);
  }

  async function send(option: PharmacyOption) {
    if (busy) return;   // a second tap must not send again: that would rotate the code just shown and notify the pharmacy twice
    setBusy(true);
    const result = await choosePharmacy(selected, option.partnerId, option.locationId);
    say(result, "pharmmob.notice.chosen");
    if (result.ok) {
      setSelected([]);
      setChoosing(false);
      setOptions(null);
    }
    await refresh();
    setBusy(false);
  }

  async function renew(group: CollectionGroup) {
    if (busy) return;
    setBusy(true);
    // sent together: one new code for the whole visit (nothing is sent to the pharmacy again); sent alone: that medicine's own new code
    const result = group.items.length > 1 ? await newVisitCode(group.items[0].prescriptionId) : await newCode(group.items[0].prescriptionId);
    say(result, "pharmmob.notice.new_code");
    await refresh();
    setBusy(false);
  }

  async function takeBack(group: CollectionGroup) {
    if (busy) return;
    setBusy(true);
    const result = await withdraw(group.items.map((i) => i.prescriptionId));
    if (!result.ok && result.done > 0) {
      // some were taken back and some could not be (one already partly supplied): say which, not just "it failed"
      setNotice({ tone: "warn", text: tr("pharmmob.partly_withdrawn", { done: result.done, total: group.items.length }) });
    } else {
      say(result, "pharmmob.notice.withdrawn");
    }
    await refresh();
    setBusy(false);
  }

  // Nothing at all while collection is closed, while nothing has loaded, or when the first load failed: most patients have nothing waiting, and a warning
  // on every visit to this screen (offline, or the app a little ahead of its database) would only worry them. Once something has loaded, a later failed
  // refresh is said out loud (the "may be out of date" line below).
  if (off || failed || !items) return null;
  const waiting = unsent(items);
  const groups = sentGroups(items);
  if (waiting.length === 0 && groups.length === 0) return null;

  return (
    <Card style={{ gap: space.md }}>
      <View style={{ gap: space.xs }}>
        <AppText variant="bodyStrong">{tr("pharmmob.title")}</AppText>
        <AppText variant="caption" tone="textMuted">{tr("pharmmob.intro")}</AppText>
      </View>
      {stale ? <InlineAlert tone="warn" message={tr("pharmmob.refresh_failed")} /> : null}
      {notice ? <InlineAlert tone={notice.tone} message={notice.text} /> : null}

      {groups.map((g) => (
        <View key={g.key} style={{ gap: space.sm }}>
          <AppText variant="bodyStrong">{tr("pharmmob.sent_to", { pharmacy: where(g) })}</AppText>
          {g.address ? <AppText variant="caption" tone="textMuted">{g.address}</AppText> : null}
          <View style={{ gap: space.xs }}>
            {g.items.map((i) => (
              <View key={i.prescriptionId}>
                <AppText variant="body">{i.medicine}</AppText>
                {i.otherPharmacyNeeded ? (
                  <AppText variant="caption" tone="warnText">{tr("pharmvisit.other_needed")}</AppText>
                ) : (
                  <AppText variant="caption" tone="textMuted">
                    {i.stockConfirmedAt ? tr("pharmvisit.stock_confirmed", { date: lagosDate(i.stockConfirmedAt) }) : tr("pharmvisit.stock_unknown")}
                  </AppText>
                )}
                {i.controlled ? <AppText variant="caption" tone="warnText">{tr("pharmmob.controlled")}</AppText> : null}
              </View>
            ))}
          </View>
          {g.items.length > 1 ? <AppText variant="caption" tone="textMuted">{tr("pharmvisit.covers", { count: g.items.length })}</AppText> : null}
          <View accessible accessibilityLabel={`${tr("pharmmob.code_label")} ${g.code ?? ""}`} style={{ gap: space.xs }}>
            <AppText variant="caption" tone="textMuted">{tr("pharmmob.code_label")}</AppText>
            <AppText variant="title" style={{ letterSpacing: 4 }}>{g.code ?? "-"}</AppText>
            <AppText variant="caption" tone="textMuted">{tr("pharmmob.code_hint")}</AppText>
            {g.codeExpiresAt ? <AppText variant="caption" tone="textMuted">{tr("pharmmob.valid_until", { date: lagosDate(g.codeExpiresAt) })}</AppText> : null}
          </View>
          {g.locked ? <InlineAlert tone="warn" message={tr("pharmmob.code_locked")} /> : g.expired ? <InlineAlert tone="warn" message={tr("pharmmob.code_expired")} /> : null}
          <Button title={tr("pharmmob.new_code")} variant="secondary" onPress={() => void renew(g)} loading={busy} />
          <Button title={tr("pharmmob.take_back")} variant="ghost" onPress={() => void takeBack(g)} disabled={busy} />
        </View>
      ))}

      {waiting.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <AppText variant="bodyStrong">{tr("pharmmob.pick_title")}</AppText>
          <AppText variant="caption" tone="textMuted">{tr("pharmmob.pick_hint")}</AppText>
          <View style={{ gap: space.xs }}>
            {waiting.map((w) => {
              const on = selected.includes(w.prescriptionId);
              return (
                <PressableScale
                  key={w.prescriptionId}
                  onPress={() => {
                    setSelected((s) => toggleSelection(s, w.prescriptionId));
                    setChoosing(false);
                  }}
                  accessibilityRole="checkbox"
                  accessibilityLabel={w.medicine}
                  accessibilityState={{ checked: on }}
                  style={{ minHeight: 48, justifyContent: "center" }}
                >
                  <AppText variant="body">{`${on ? "[x]" : "[ ]"} ${w.medicine}`}</AppText>
                  {w.controlled ? <AppText variant="caption" tone="warnText">{tr("pharmmob.controlled")}</AppText> : null}
                </PressableScale>
              );
            })}
          </View>
          {!choosing ? (
            <Button title={tr("pharmmob.choose_pharmacy")} onPress={() => void openChooser()} disabled={selected.length === 0} loading={busy} />
          ) : options && options.length === 0 ? (
            <AppText variant="body" tone="textMuted">{tr("pharmmob.no_pharmacies")}</AppText>
          ) : (
            <View style={{ gap: space.xs }}>
              {(options ?? []).map((o) => (
                <Chip
                  key={o.locationId}
                  label={tr("pharmmob.send_to", { pharmacy: [o.partnerName, o.locationName].filter(Boolean).join(", ") })}
                  selected={false}
                  onPress={() => void send(o)}
                />
              ))}
            </View>
          )}
        </View>
      ) : null}
    </Card>
  );
}
