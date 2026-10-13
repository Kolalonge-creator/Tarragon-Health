import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { loadFollowups, pickFollowupSlot, requestLongerCall } from "@/lib/followups";
import { isFollowupMember, openSlots, slotLabel, type Followups } from "@/lib/followups-model";
import { formatWhen } from "@/lib/consultation-room-model";
import { space } from "@/ui/design";
import { AppText, Button, Card, Chip, InlineAlert } from "@/ui/kit";

type LoadState = { kind: "loading" } | { kind: "failed" } | { kind: "ready"; data: Followups; stale: boolean };

/**
 * "Your monthly check-in" in the Care area (two-tier model, item 3): the times the care team has offered, and one tap to choose one.
 * The same database functions as the web card; the pick runs the live hold and confirm. A failed load says so (and that nothing is
 * lost), it never reads as "no times waiting", and a list that already loaded stays on screen marked as possibly out of date.
 * Shown only to Members. The care team is never named (OQ-129). NOT run on a real phone: no EAS dev client build exists yet.
 */
export function MonthlyCheckinSection() {
  const locale = asLocale(useUiLanguage());
  const tr = (key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [askLonger, setAskLonger] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "danger"; text: string } | null>(null);

  const issued = useRef(0);
  const lastSuccess = useRef(0);
  const mounted = useRef(true);
  const load = useCallback(async () => {
    const mine = ++issued.current;
    const res = await loadFollowups();
    if (!mounted.current || mine < lastSuccess.current) return;
    if (res.ok) {
      lastSuccess.current = mine;
      setState({ kind: "ready", data: res.data, stale: false });
    } else if (lastSuccess.current === 0) {
      setState({ kind: "failed" });
    } else {
      setState((prev) => (prev.kind === "ready" ? { ...prev, stale: true } : prev));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void load();
    });
    return () => {
      mounted.current = false;
      sub.remove();
    };
  }, [load]);

  const choose = useCallback(
    async (slotId: string) => {
      setBusy(true);
      setNotice(null);
      const outcome = await pickFollowupSlot(slotId, askLonger);
      if (!mounted.current) return;
      setBusy(false);
      if (outcome.kind === "booked") {
        setNotice({ tone: "info", text: tr("followups.patient.picked", { when: formatWhen(outcome.startsAt) }) });
      } else if (outcome.kind === "unavailable") {
        setNotice({ tone: "info", text: tr("followups.patient.unavailable") });
      } else if (outcome.kind === "expired") {
        setNotice({ tone: "info", text: tr("followups.patient.expired") });
      } else {
        setNotice({ tone: "danger", text: tr("followups.patient.error") });
      }
      void load();
    },
    [askLonger, load, locale],
  );

  const askMore = useCallback(
    async (encounterId: string) => {
      setBusy(true);
      const ok = await requestLongerCall(encounterId);
      if (!mounted.current) return;
      setBusy(false);
      setNotice(ok ? { tone: "info", text: tr("followups.patient.longer_asked") } : { tone: "danger", text: tr("followups.patient.error") });
    },
    [locale],
  );

  if (state.kind === "ready" && !isFollowupMember(state.data)) return null;

  const data = state.kind === "ready" ? state.data : null;
  const now = Date.now();
  const open = data ? data.offers.map((o) => ({ offer: o, slots: openSlots(o, now) })).filter((x) => x.slots.length > 0) : [];
  const booked = data?.entitlement?.current?.state === "booked" ? data.entitlement.current : null;

  return (
    <Card style={{ gap: space.md }}>
      <AppText variant="title" heading>
        {tr("followups.patient.title")}
      </AppText>
      <AppText variant="body" tone="textMuted">
        {tr("followups.patient.subtitle")}
      </AppText>
      {state.kind === "loading" ? (
        <AppText variant="body" tone="textMuted" accessibilityLiveRegion="polite">
          {tr("consult.mobile.loading")}
        </AppText>
      ) : null}
      {state.kind === "failed" ? (
        <View style={{ gap: space.sm }}>
          <InlineAlert tone="info" message={tr("followups.patient.load_error")} />
          <Button title={tr("consult.mobile.retry")} variant="secondary" onPress={() => void load()} />
        </View>
      ) : null}
      {state.kind === "ready" && state.stale ? <InlineAlert tone="info" message={tr("consult.mobile.offline")} /> : null}
      {notice ? <InlineAlert tone={notice.tone} message={notice.text} /> : null}
      {data?.entitlement?.current ? (
        <AppText variant="caption" tone="textMuted">
          {tr("followups.patient.month", { month: data.entitlement.current.month_index })}
          {data.entitlement.consumed > 0 ? `. ${tr("followups.patient.done_count", { done: data.entitlement.consumed })}` : ""}
        </AppText>
      ) : null}
      {booked && booked.encounter_id ? (
        <Button title={tr("followups.patient.ask_longer")} variant="secondary" disabled={busy} onPress={() => void askMore(booked.encounter_id as string)} />
      ) : null}
      {state.kind === "ready" && open.length === 0 && !booked ? (
        <AppText variant="body" tone="textMuted">
          {tr("followups.patient.none")}
        </AppText>
      ) : null}
      {open.map(({ offer, slots }) => (
        <View key={offer.offer_id} style={{ gap: space.sm }}>
          <AppText variant="label">{tr("followups.patient.waiting")}</AppText>
          <AppText variant="caption" tone="textMuted">
            {tr("followups.patient.expires", { when: formatWhen(offer.expires_at) })} {tr("followups.patient.length", { minutes: offer.call_minutes })}
          </AppText>
          <Chip label={tr("followups.patient.longer")} selected={askLonger} onPress={() => setAskLonger((v) => !v)} />
          {slots.map((slot) => (
            <Button
              key={slot.slot_id}
              title={`${slotLabel(slot)}  ${busy ? tr("followups.patient.choosing") : tr("followups.patient.choose")}`}
              variant="secondary"
              disabled={busy}
              onPress={() => void choose(slot.slot_id)}
              accessibilityHint={slotLabel(slot)}
            />
          ))}
        </View>
      ))}
    </Card>
  );
}
