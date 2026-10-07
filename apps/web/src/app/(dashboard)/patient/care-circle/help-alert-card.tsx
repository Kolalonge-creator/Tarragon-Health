"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { t, type Locale } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

const TOUCH = "min-h-11";

interface SendResult { recipients_told: number; already_sent: boolean; location_shared: boolean; supporters?: number }

/** Reads the patient's own consent row. A missing row means no consent. */
function useLocationConsent(patientId: string) {
  return useQuery({
    queryKey: ["care-circle", "help-consent", patientId],
    queryFn: async () => {
      const { data, error } = await createClient().from("care_circle_location_consents" as never).select("granted").eq("patient_id", patientId).maybeSingle();
      if (error) throw new Error(error.message);
      return Boolean((data as { granted: boolean } | null)?.granted);
    },
  });
}

/** The location is asked for from the browser ONLY inside the tap handler, and only when consent is on. Never on page load, never in the background.
 * It must never hold the alert back: the browser's own timeout does not start until a permission prompt is answered, so a hard timer races it. */
function currentPosition(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    const giveUp = setTimeout(() => resolve(null), 4_000);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(giveUp);
        const accuracy = Number.isFinite(p.coords.accuracy) ? Math.min(100_000, Math.max(0, Math.round(p.coords.accuracy))) : 0;
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy });
      },
      () => {
        clearTimeout(giveUp);
        resolve(null);
      },
      { timeout: 3_000, maximumAge: 0 },
    );
  });
}

export function HelpAlertCard({ patientId, locale }: { patientId: string; locale: Locale }) {
  const qc = useQueryClient();
  const consent = useLocationConsent(patientId);
  const [result, setResult] = useState<SendResult | null>(null);

  const setConsent = useMutation({
    mutationFn: async (granted: boolean) => {
      const { error } = await createClient().rpc("set_circle_location_consent", { p_granted: granted });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["care-circle", "help-consent", patientId] }),
  });

  const send = useMutation({
    mutationFn: async () => {
      const pos = consent.data ? await currentPosition() : null;
      const { data, error } = await createClient().rpc("send_circle_help_alert", pos ? { p_lat: pos.lat, p_lng: pos.lng, p_accuracy_m: pos.accuracy } : {});
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
      return data as unknown as SendResult;
    },
    onSuccess: (r) => setResult(r),
  });

  const notOpen = (send.error as { code?: string } | null)?.code === "55000" || (setConsent.error as { code?: string } | null)?.code === "55000";
  const on = consent.data === true;
  return (
    <Card>
      <CardHeader><CardTitle>{t("circle.help.title", locale)}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p>{t("circle.help.intro", locale)}</p>
        <section aria-label={t("circle.help.consent.title", locale)} className="space-y-2 rounded-lg border p-3">
          <h4 className="font-medium">{t("circle.help.consent.title", locale)}</h4>
          <p className="text-sm">{t("circle.help.consent.text", locale)}</p>
          <p className="text-sm font-medium">{on ? t("circle.help.consent.on", locale) : t("circle.help.consent.off", locale)}</p>
          <Button variant="outline" className={TOUCH} disabled={setConsent.isPending || consent.isLoading} onClick={() => setConsent.mutate(!on)}>
            {on ? t("circle.help.consent.turn_off", locale) : t("circle.help.consent.turn_on", locale)}
          </Button>
          {setConsent.isError && !notOpen ? <p role="alert" className="text-sm">{t("circle.help.consent.error", locale)}</p> : null}
        </section>
        <Button className={TOUCH} disabled={send.isPending} onClick={() => send.mutate()}>{t("circle.help.button", locale)}</Button>
        {notOpen ? <p role="status">{t("circle.help.not_open", locale)}</p> : null}
        {send.isError && !notOpen ? <p role="alert">{t("circle.help.error", locale)}</p> : null}
        {result ? (
          <div role="status" className="space-y-1">
            <p>
              {result.already_sent
                ? t("circle.help.already", locale)
                : result.recipients_told > 0
                  ? t("circle.help.sent", locale, { count: String(result.recipients_told) })
                  : t("circle.help.sent_none", locale)}
            </p>
            <p className="text-sm">{result.location_shared ? t("circle.help.location_on", locale) : t("circle.help.location_off", locale)}</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
