import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import {
  loadCollection,
  loadOptions,
  sendToPharmacy,
  withdrawFromPharmacy,
  type CollectionPrescription,
  type PharmacyOption,
} from "@/lib/pharmacy-collection";
import { useUiLanguage } from "@/lib/ui-language";
import { space } from "@/ui/design";
import { AppText, Button, Card, InlineAlert, PressableScale } from "@/ui/kit";

/**
 * "Collect your medicines from a pharmacy" (S28) on the Medicines tab. Choose a partner pharmacy (stock as it lists it,
 * no price, no delivery), tick that you agree to share it, and get a code to show at the counter. Needs a
 * connection and is never queued. The downloaded form for any pharmacy stays on the web and is mentioned, not replaced.
 */
function Chooser({ prescription, mode, onDone }: { prescription: CollectionPrescription; mode: "send" | "reroute"; onDone: () => void }) {
  const locale = asLocale(useUiLanguage());
  const tr = useCallback((key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params), [locale]);
  const [options, setOptions] = useState<PharmacyOption[] | null>(null);
  const [message, setMessage] = useState<MessageKey | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadOptions(prescription.id).then((r) => {
      if (!alive) return;
      if (r.ok) {
        setOptions(r.options);
        // the last pharmacy is ticked already, so a repeat is one tap and the consent tick
        const usual = r.options.find((o) => o.isPreferred);
        if (usual) setChosen(usual.id);
      } else setMessage(r.key);
    });
    return () => {
      alive = false;
    };
  }, [prescription.id]);

  async function send() {
    if (!chosen || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await sendToPharmacy(mode, prescription.id, chosen, consent);
      if (r.ok) onDone();
      else setMessage(r.key);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: space.sm }}>
      {options === null && message === null ? <AppText variant="caption" tone="textMuted">{tr("pharmacy.loading")}</AppText> : null}
      {options && options.length === 0 ? <AppText variant="body">{tr("pharmacy.none")}</AppText> : null}
      {options && options.length > 0 ? (
        <>
          <AppText variant="caption" tone="textMuted">{tr("pharmacy.stock.note")}</AppText>
          {options.map((o) => (
            <PressableScale
              key={o.id}
              onPress={() => setChosen(o.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: chosen === o.id, checked: chosen === o.id }}
              accessibilityLabel={`${o.name}. ${o.place}. ${tr(`pharmacy.stock.${o.stock}` as MessageKey)}`}
            >
              <Card style={{ gap: 2, borderWidth: chosen === o.id ? 2 : 0 }}>
                <AppText variant="bodyStrong">{o.name}</AppText>
                {o.place ? <AppText variant="caption" tone="textMuted">{o.place}</AppText> : null}
                <AppText variant="caption" tone="textMuted">
                  {`${tr(`pharmacy.stock.${o.stock}` as MessageKey)}${o.isPreferred ? `. ${tr("pharmacy.preferred")}` : ""}`}
                </AppText>
              </Card>
            </PressableScale>
          ))}
          <PressableScale
            onPress={() => setConsent((c) => !c)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: consent }}
            accessibilityLabel={tr("pharmacy.consent")}
          >
            <AppText variant="body">{`${consent ? "[x]" : "[ ]"} ${tr("pharmacy.consent")}`}</AppText>
          </PressableScale>
          <Button title={busy ? tr("pharmacy.sending") : tr("pharmacy.send")} disabled={busy || !chosen || !consent} loading={busy} onPress={() => void send()} />
          <Button title={tr("pharmacy.cancel")} variant="secondary" disabled={busy} onPress={onDone} />
        </>
      ) : null}
      {message ? <InlineAlert tone="info" message={tr(message)} /> : null}
    </View>
  );
}

function Row({ prescription, reload }: { prescription: CollectionPrescription; reload: () => Promise<void> }) {
  const locale = asLocale(useUiLanguage());
  const tr = useCallback((key: MessageKey, params?: Record<string, string | number>) => t(key, locale, params), [locale]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<MessageKey | null>(null);
  const mine = prescription.pharmacy;
  async function takeBack() {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await withdrawFromPharmacy(prescription.id);
      setNote(r.key);
      if (r.ok) await reload();
    } finally {
      setBusy(false);
    }
  }
  const done = () => {
    setOpen(false);
    void reload();
  };

  return (
    <View style={{ gap: space.sm }}>
      <AppText variant="bodyStrong">{prescription.medicines.join(", ")}</AppText>
      {prescription.state === "signed" || (prescription.state === "dispensed" && prescription.canRepeat) ? (
        open ? (
          <Chooser prescription={prescription} mode="send" onDone={done} />
        ) : (
          <Button title={prescription.state === "dispensed" ? tr("pharmacy.repeat") : tr("pharmacy.choose")} onPress={() => setOpen(true)} />
        )
      ) : null}
      {prescription.state === "sent" && mine?.sent ? (
        <View style={{ gap: space.xs }}>
          <AppText variant="body">{tr("pharmacy.sent.title", { pharmacy: mine.pharmacyName })}</AppText>
          {mine.needsOther ? (
            <AppText variant="bodyStrong">{tr("pharmacy.other.needed")}</AppText>
          ) : (
            <>
              <AppText variant="caption" tone="textMuted">{tr("pharmacy.sent.code_label")}</AppText>
              <AppText variant="headline" accessibilityLabel={`${tr("pharmacy.sent.code_label")} ${mine.code ?? ""}`}>{mine.code ?? ""}</AppText>
              <AppText variant="caption" tone="textMuted">{tr("pharmacy.sent.show")}</AppText>
              <AppText variant="caption" tone="textMuted">{tr("pharmacy.sent.waiting")}</AppText>
            </>
          )}
          {open ? <Chooser prescription={prescription} mode="reroute" onDone={done} /> : <Button title={tr("pharmacy.change")} variant="secondary" onPress={() => setOpen(true)} />}
          <Button title={tr("pharmacy.withdraw")} variant="secondary" disabled={busy} loading={busy} onPress={() => void takeBack()} />
          {note ? <InlineAlert tone="info" message={tr(note)} /> : null}
        </View>
      ) : null}
      {prescription.state === "dispensed" && mine?.sent ? <AppText variant="body">{tr("pharmacy.dispensed", { pharmacy: mine.pharmacyName })}</AppText> : null}
    </View>
  );
}

export function PharmacyCollectionCard() {
  const locale = asLocale(useUiLanguage());
  const tr = useCallback((key: MessageKey) => t(key, locale), [locale]);
  const [rows, setRows] = useState<CollectionPrescription[] | null>(null);
  const [failed, setFailed] = useState<"offline" | "error" | null>(null);

  const load = useCallback(async () => {
    const r = await loadCollection();
    if (!r.ok) {
      setFailed(r.offline ? "offline" : "error");
      return;
    }
    setFailed(null);
    setRows(r.available ? r.prescriptions : []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed && rows === null) {
    return (
      <Card style={{ gap: space.sm }}>
        <AppText variant="bodyStrong">{tr("pharmacy.title")}</AppText>
        <InlineAlert tone="info" message={tr(failed === "offline" ? "pharmacy.error.offline" : "pharmacy.error")} />
      </Card>
    );
  }
  if (!rows || rows.length === 0) return null;

  return (
    <Card style={{ gap: space.md }}>
      <AppText variant="title" heading>{tr("pharmacy.title")}</AppText>
      <AppText variant="body">{tr("pharmacy.intro")}</AppText>
      <AppText variant="caption" tone="textMuted">{tr("pharmacy.no_delivery")}</AppText>
      {rows.map((p) => (
        <Row key={p.id} prescription={p} reload={load} />
      ))}
      <AppText variant="caption" tone="textMuted">{tr("pharmacy.any_pharmacy")}</AppText>
    </Card>
  );
}
