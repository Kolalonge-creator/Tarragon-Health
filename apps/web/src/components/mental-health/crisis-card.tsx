"use client";

import { useEffect, useState } from "react";
import { CRISIS_CARD_OFFLINE, normaliseCrisisCard, type CrisisCardData } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The crisis card (function 10.3). Same screen, no navigation, no model (INV-01), and it works with no signal (INV-06): its content
 * is bundled (CRISIS_CARD_OFFLINE in @tarragon/shared plus the catalogue strings), and the helpline list from the server is cached on
 * this device. A helpline is shown only if a human verified it recently; otherwise the card says helplines are still being confirmed
 * and points to the emergency number and the nearest hospital. The card never shows a number it has not been told is verified, and
 * normaliseCrisisCard drops one again on this side if the server ever sent it.
 *
 * `told` is true when the screen has just raised a crisis, so the card can say the care team has been told.
 */
const CACHE_KEY = "tarragon.crisisCard.v1";

function readCache(): CrisisCardData | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { emergency_number?: string; helplines?: unknown; callback_sla_minutes?: unknown };
    return normaliseCrisisCard(parsed);
  } catch {
    return null;
  }
}

export function CrisisCard({ told = false }: { told?: boolean }) {
  const [card, setCard] = useState<CrisisCardData>({ ...CRISIS_CARD_OFFLINE, helplines: [] });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = readCache();
      if (cached && !cancelled) setCard(cached);
      try {
        const { data, error } = await createClient().rpc("get_crisis_card");
        if (error || cancelled) return;
        setCard(normaliseCrisisCard(data));
        try { window.localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* a blocked store only costs the offline copy */ }
      } catch {
        /* offline: the bundled or cached card stays on screen */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <Card role="region" aria-label={t("crisis.title")} className="border-red-300 dark:border-red-500/40">
      <CardHeader>
        <CardTitle className="text-base">{t("crisis.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-charcoal-ink/90 dark:text-night-ink/90">
        <p>{t("crisis.lead")}</p>
        {told && <p className="font-medium">{t("crisis.care_team_told")}</p>}
        {told && card.callbackSlaMinutes !== null && <p>{t("crisis.care_team_sla", "en", { minutes: card.callbackSlaMinutes })}</p>}

        <div className="space-y-1">
          <a
            href={`tel:${card.emergencyNumber}`}
            className="inline-flex min-h-11 items-center rounded-md bg-red-600 px-4 py-2 font-semibold text-white"
          >
            {t("crisis.call", "en", { number: card.emergencyNumber })}
          </a>
          <p className="text-xs text-charcoal-ink/65 dark:text-night-ink/65">{t("crisis.call_note")}</p>
        </div>

        <div className="space-y-1">
          <p className="font-medium">{t("crisis.hospital")}</p>
          <a
            href="https://www.google.com/maps/search/?api=1&query=nearest+hospital+emergency"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-green dark:text-brand-green-bright underline"
          >
            {t("crisis.hospital_map")}
          </a>
          <p className="text-xs text-charcoal-ink/65 dark:text-night-ink/65">{t("crisis.hospital_offline")}</p>
        </div>

        <div className="space-y-1">
          <p className="font-medium">{t("crisis.helplines_title")}</p>
          {card.helplines.length === 0 ? (
            <p>{t("crisis.helplines_unverified", "en", { number: card.emergencyNumber })}</p>
          ) : (
            <ul className="space-y-1">
              {card.helplines.map((h) => (
                <li key={h.name}>
                  <a href={`tel:${h.phone_e164}`} className="font-medium underline">{h.name}</a>
                  {h.hours_text ? <span className="block text-xs">{t("crisis.helpline_hours", "en", { hours: h.hours_text })}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="text-xs">{t("crisis.stay_with_someone")}</p>
      </CardContent>
    </Card>
  );
}
