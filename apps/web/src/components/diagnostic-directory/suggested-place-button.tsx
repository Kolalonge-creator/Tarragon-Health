"use client";

import { useState, useTransition } from "react";
import { t } from "@tarragon/i18n";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { formatPatientDate } from "@/lib/format-date";
import { openSuggestedPlaceAction, type PlaceRead } from "@/lib/diagnostic-directory/orders";

const locale = DEFAULT_UI_LANGUAGE;

/**
 * Patient: open the place a doctor suggested for one lab or imaging order. Opening it is what records that the patient has
 * seen it (the database stamps the first view). The partner badge carries its commercial explanation, and the card always
 * says the patient may go anywhere.
 */
export function SuggestedPlaceButton({ kind, orderId }: { kind: "lab" | "imaging"; orderId: string }) {
  const [read, setRead] = useState<PlaceRead | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const toggle = () => {
    if (open) return setOpen(false);
    setOpen(true);
    if (!read || !read.ok) start(async () => setRead(await openSuggestedPlaceAction({ kind, orderId })));
  };

  return (
    <div className="space-y-2">
      <button type="button" onClick={toggle} aria-expanded={open}
        className="text-sm font-semibold text-brand-green underline-offset-2 hover:underline">
        {open ? t("dxsearch.place.hide", locale) : t("dxsearch.place.open", locale)}
      </button>
      {open && (
        <div className="rounded-lg border border-charcoal-ink/10 p-3 text-sm" aria-live="polite">
          {pending || !read ? (
            <p className="text-charcoal-ink/70">{t("dxsearch.place.loading", locale)}</p>
          ) : !read.ok ? (
            <p role="alert" className="text-amber-900">{t("dxsearch.place.error", locale)}</p>
          ) : !read.place ? (
            <p className="text-charcoal-ink/80">{t("dxsearch.place.none", locale)}</p>
          ) : (
            <PlaceCard place={read.place} />
          )}
        </div>
      )}
    </div>
  );
}

function PlaceCard({ place }: { place: NonNullable<Extract<PlaceRead, { ok: true }>["place"]> }) {
  const maps = place.latitude !== null && place.longitude !== null
    ? `https://www.google.com/maps/search/?api=1&query=${place.latitude},${place.longitude}` : null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-charcoal-ink/60">
        {t("dxsearch.place.title", locale, { name: place.suggested_by ?? "Your doctor", date: formatPatientDate(place.suggested_at) })}
      </p>
      <p className="font-semibold text-charcoal-ink">{place.provider_name}: {place.branch_name}</p>
      {place.is_partner && (
        <details className="text-xs">
          <summary className="inline-block cursor-pointer rounded-full border border-charcoal-ink/30 px-2 py-0.5 font-semibold text-charcoal-ink">
            {t("dxsearch.partner.badge", locale)}
          </summary>
          <p className="mt-1 text-charcoal-ink/70">{t("dxsearch.partner.explainer", locale)}</p>
        </details>
      )}
      <p className="text-charcoal-ink/80">{[place.address, place.town, place.lga, place.state].filter(Boolean).join(", ")}</p>
      {place.phone && <p><a className="text-brand-green hover:underline" href={`tel:${place.phone}`}>{place.phone}</a></p>}
      {maps && <p><a className="text-brand-green hover:underline" href={maps} target="_blank" rel="noopener noreferrer">{t("dxsearch.place.directions", locale)}</a></p>}
      <p className="text-xs text-charcoal-ink/70">{t("dxsearch.place.for", locale, { test: place.test })}</p>
      {place.appointment_required && <p className="text-xs text-charcoal-ink/80">{t("dxsearch.place.call_first", locale)}</p>}
      {place.preparation_note && <p className="text-xs text-charcoal-ink/80">{t("dxsearch.place.prep", locale, { note: place.preparation_note })}</p>}
      {!place.still_recommendable && <p role="alert" className="text-xs font-semibold text-amber-900">{t("dxsearch.place.no_longer", locale)}</p>}
      <p className="text-xs text-charcoal-ink/60">{t("dxsearch.place.free_choice", locale)}</p>
    </div>
  );
}
