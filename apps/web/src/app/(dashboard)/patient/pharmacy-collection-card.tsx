"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t, type Locale, type MessageKey, type MessageParams } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatKobo } from "@/lib/format-money";
import type { PharmacyOption } from "@/lib/pharmacy-collection/collection";
import type { CollectionPrescription } from "@/lib/pharmacy-collection/load";
import { loadPharmacyOptions, reroutePharmacy, sendToPharmacy, withdrawFromPharmacy } from "@/lib/pharmacy-collection/actions";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";

/**
 * "Collect your medicines from a pharmacy" (S28, spec 8.9). One row per signed prescription. The patient chooses a partner
 * pharmacy (prices for what was prescribed, stock, no delivery), ticks that she agrees to share it, and gets a collection
 * code to show at the counter. Collection only: there is no delivery option anywhere on this card (Part C.2). The
 * downloaded form stays available for any pharmacy.
 */
function Chooser({
  prescription,
  locale,
  mode,
  onDone,
}: {
  prescription: CollectionPrescription;
  locale: Locale;
  mode: "send" | "reroute";
  onDone: () => void;
}) {
  const router = useRouter();
  const tr = (key: MessageKey, params?: MessageParams) => t(key, locale, params);
  const [options, setOptions] = useState<PharmacyOption[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<MessageKey | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    void loadPharmacyOptions(prescription.id).then((r) => {
      if (!alive) return;
      setLoading(false);
      if (r.ok) setOptions(r.options);
      else setMessage(r.key);
    });
    return () => {
      alive = false;
    };
  }, [prescription.id]);

  function send() {
    if (!chosen) return;
    setMessage(null);
    startTransition(async () => {
      const input = { prescriptionId: prescription.id, partnerId: chosen, consent };
      const result = mode === "send" ? await sendToPharmacy(input) : await reroutePharmacy(input);
      if (!result.ok) {
        setMessage(result.key);
        return;
      }
      onDone();
      router.refresh();
    });
  }

  function priceLine(o: PharmacyOption): string {
    if (o.items_priced === 0) return tr("pharmacy.price.none");
    const amount = formatKobo(o.total_kobo);
    return o.items_priced === o.items_total
      ? tr("pharmacy.price.total", { amount })
      : tr("pharmacy.price.partial", { amount, priced: o.items_priced, total: o.items_total });
  }

  return (
    <div className="space-y-3 rounded-md border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
      {loading && <p className={`text-sm ${MUTED}`}>{tr("pharmacy.loading")}</p>}
      {!loading && options && options.length === 0 && <p className="text-sm">{tr("pharmacy.none")}</p>}
      {options && options.length > 0 && (
        <>
          <p className={`text-xs ${MUTED}`}>{tr("pharmacy.compare.note")}</p>
          <fieldset className="space-y-2">
            <legend className="sr-only">{tr("pharmacy.choose")}</legend>
            {options.map((o) => (
              <div key={o.pharmacy_partner_id}>
                <label className="flex cursor-pointer items-start gap-3 rounded-md border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
                  <input
                    type="radio"
                    name={`pharmacy-${prescription.id}`}
                    className="mt-1 h-4 w-4"
                    checked={chosen === o.pharmacy_partner_id}
                    onChange={() => setChosen(o.pharmacy_partner_id)}
                  />
                  <span className="space-y-0.5">
                    <span className="block text-sm font-medium">{o.name}</span>
                    <span className={`block text-xs ${MUTED}`}>{[o.area, o.city].filter(Boolean).join(", ")}</span>
                    <span className="block text-sm">{priceLine(o)}</span>
                    <span className={`block text-xs ${MUTED}`}>
                      {tr(`pharmacy.stock.${o.stock}` as MessageKey)}
                      {o.is_preferred ? `. ${tr("pharmacy.preferred")}` : ""}
                    </span>
                  </span>
                </label>
              </div>
            ))}
          </fieldset>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>{tr("pharmacy.consent")}</span>
          </label>
          <div className="flex flex-wrap gap-3">
            <Button type="button" className="min-h-11" disabled={pending || !chosen || !consent} onClick={send}>
              {pending ? tr("pharmacy.sending") : tr("pharmacy.send")}
            </Button>
            <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={onDone}>
              {tr("pharmacy.cancel")}
            </Button>
          </div>
        </>
      )}
      <p role="status" aria-live="polite" className="text-sm">
        {message ? tr(message) : null}
      </p>
    </div>
  );
}

function Row({ prescription, locale }: { prescription: CollectionPrescription; locale: Locale }) {
  const tr = (key: MessageKey, params?: MessageParams) => t(key, locale, params);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<MessageKey | null>(null);
  const mine = prescription.pharmacy;

  function takeBack() {
    setNote(null);
    startTransition(async () => {
      const r = await withdrawFromPharmacy(prescription.id);
      setNote(r.key);
      router.refresh();
    });
  }
  const sent = mine !== null && mine.sent;
  const waiting = prescription.state === "sent" && sent;
  const dispensed = prescription.state === "dispensed" && sent;

  return (
    <li className="space-y-3 py-4">
      <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{prescription.medicines.join(", ")}</p>

      {prescription.state === "signed" && !open && (
        <Button type="button" className="min-h-11" onClick={() => setOpen(true)}>
          {tr("pharmacy.choose")}
        </Button>
      )}
      {prescription.state === "signed" && open && (
        <Chooser prescription={prescription} locale={locale} mode="send" onDone={() => setOpen(false)} />
      )}

      {waiting && mine.sent && (
        <div className="space-y-2">
          <p className="text-sm">{tr("pharmacy.sent.title", { pharmacy: mine.pharmacy_name })}</p>
          {mine.needs_other_pharmacy ? (
            <p className="text-sm font-medium">{tr("pharmacy.other.needed")}</p>
          ) : (
            <>
              <p className={`text-xs ${MUTED}`}>{tr("pharmacy.sent.code_label")}</p>
              <p className="font-mono text-2xl font-semibold tracking-widest" aria-label={tr("pharmacy.sent.code_label")}>
                {mine.collection_code}
              </p>
              <p className={`text-xs ${MUTED}`}>{tr("pharmacy.sent.show")}</p>
              <p className={`text-xs ${MUTED}`}>{tr("pharmacy.sent.waiting")}</p>
            </>
          )}
          {!open && (
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setOpen(true)}>
              {tr("pharmacy.change")}
            </Button>
          )}
          {open && <Chooser prescription={prescription} locale={locale} mode="reroute" onDone={() => setOpen(false)} />}
          <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={takeBack}>
            {tr("pharmacy.withdraw")}
          </Button>
          <p role="status" aria-live="polite" className="text-sm">
            {note ? tr(note) : null}
          </p>
        </div>
      )}

      {dispensed && mine.sent && <p className="text-sm">{tr("pharmacy.dispensed", { pharmacy: mine.pharmacy_name })}</p>}
    </li>
  );
}

export function PharmacyCollectionCard({ prescriptions, locale }: { prescriptions: CollectionPrescription[]; locale: Locale }) {
  const tr = (key: MessageKey) => t(key, locale);
  if (prescriptions.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tr("pharmacy.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-charcoal-ink dark:text-night-ink">{tr("pharmacy.intro")}</p>
        <p className={`text-xs ${MUTED}`}>{tr("pharmacy.no_delivery")}</p>
        <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
          {prescriptions.map((p) => (
            <Row key={p.id} prescription={p} locale={locale} />
          ))}
        </ul>
        <p className={`text-xs ${MUTED}`}>{tr("pharmacy.any_pharmacy")}</p>
      </CardContent>
    </Card>
  );
}
