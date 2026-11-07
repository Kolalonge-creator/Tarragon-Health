"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { t, type Locale } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { useMyCircle } from "@/lib/queries/care-circle";
import {
  HELP_NOTE_MAX,
  HELP_REQUEST_TYPES,
  buildHelpAlertArgs,
  helpRequestTypeLabelKey,
  isMissingTypedSignature,
  withoutTypedArgs,
  type HelpRequestType,
} from "@/lib/care-circle/help-request";

const TOUCH = "min-h-11";

interface SendResult { recipients_told: number; already_sent: boolean; location_shared: boolean; supporters?: number; circle_paused?: boolean }

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
  // P1 (D-help): while the circle's alerts are paused the button still works; the patient is told so before pressing it
  const circle = useMyCircle();
  const alertsPaused = circle.data?.pause?.pause_alerts === true;
  const [result, setResult] = useState<SendResult | null>(null);
  // P22 / PD-08: the patient says what kind of help they want, and may add a short note. Supporters see both, nothing clinical.
  const [type, setType] = useState<HelpRequestType | null>(null);
  const [note, setNote] = useState("");
  const [needType, setNeedType] = useState(false);

  const setConsent = useMutation({
    mutationFn: async (granted: boolean) => {
      const { error } = await createClient().rpc("set_circle_location_consent", { p_granted: granted });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["care-circle", "help-consent", patientId] }),
  });

  const send = useMutation({
    mutationFn: async (chosen: HelpRequestType) => {
      const pos = consent.data ? await currentPosition() : null;
      const args = buildHelpAlertArgs({ type: chosen, note }, pos);
      if (!args) throw Object.assign(new Error("invalid help request"), { code: "22023" });
      const supabase = createClient();
      let { data, error } = await supabase.rpc("send_circle_help_alert", args);
      // Deploy window only: the app is live before the database has the typed version. Asking for help must still work.
      if (isMissingTypedSignature(error)) ({ data, error } = await supabase.rpc("send_circle_help_alert", withoutTypedArgs(args)));
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
      return data as unknown as SendResult;
    },
    onSuccess: (r) => setResult(r),
  });

  function ask() {
    if (!type) {
      setNeedType(true);
      return;
    }
    setNeedType(false);
    send.mutate(type);
  }

  const invalid = (send.error as { code?: string } | null)?.code === "22023";
  const notOpen = (send.error as { code?: string } | null)?.code === "55000" || (setConsent.error as { code?: string } | null)?.code === "55000";
  const on = consent.data === true;
  return (
    <Card>
      <CardHeader><CardTitle>{t("circle.help.title", locale)}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p>{t("circle.help.intro", locale)}</p>
        <p className="text-sm font-medium">{t("circlehelp.not_emergency", locale)}</p>
        {alertsPaused ? <p className="text-sm font-medium">{t("circlep1.help.paused_warning", locale)}</p> : null}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("circlehelp.type.label", locale)}</legend>
          {HELP_REQUEST_TYPES.map((k) => (
            <label key={k} className={`${TOUCH} flex items-center gap-3 text-sm`}>
              <input
                type="radio"
                name={`help-type-${patientId}`}
                value={k}
                checked={type === k}
                onChange={() => {
                  setType(k);
                  setNeedType(false);
                }}
                className="h-4 w-4 accent-brand-green"
              />
              {t(helpRequestTypeLabelKey(k), locale)}
            </label>
          ))}
          {needType ? <p role="alert" className="text-sm">{t("circlehelp.type.required", locale)}</p> : null}
        </fieldset>
        <div className="space-y-1">
          <Label htmlFor={`help-note-${patientId}`}>{t("circlehelp.note.label", locale)}</Label>
          <Textarea
            id={`help-note-${patientId}`}
            value={note}
            maxLength={HELP_NOTE_MAX}
            rows={2}
            aria-describedby={`help-note-hint-${patientId}`}
            onChange={(e) => setNote(e.target.value)}
          />
          <p id={`help-note-hint-${patientId}`} className="text-xs">{t("circlehelp.note.hint", locale)}</p>
        </div>
        <Button className={`${TOUCH} w-full sm:w-auto`} disabled={send.isPending} onClick={ask}>{t("circle.help.button", locale)}</Button>
        {notOpen ? <p role="status">{t("circle.help.not_open", locale)}</p> : null}
        {invalid ? <p role="alert">{t("circlehelp.invalid", locale)}</p> : null}
        {send.isError && !notOpen && !invalid ? <p role="alert">{t("circle.help.error", locale)}</p> : null}
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
            {result.circle_paused && result.recipients_told > 0 ? <p className="text-sm">{t("circlep1.help.sent_paused", locale)}</p> : null}
          </div>
        ) : null}
        {/* The help button comes first; the location choice sits right under it, with its current state in the heading so it is
            never hidden (design audit P3). The choice itself is unchanged. */}
        <Disclosure
          title={t("circle.help.consent.title", locale)}
          hint={consent.isLoading ? undefined : on ? t("circle.help.consent.on", locale) : t("circle.help.consent.off", locale)}
        >
          <section aria-label={t("circle.help.consent.title", locale)} className="space-y-2 rounded-lg border p-3">
            <h4 className="font-medium">{t("circle.help.consent.title", locale)}</h4>
            <p className="text-sm">{t("circle.help.consent.text", locale)}</p>
            <p className="text-sm font-medium">{on ? t("circle.help.consent.on", locale) : t("circle.help.consent.off", locale)}</p>
            <Button variant="outline" className={TOUCH} disabled={setConsent.isPending || consent.isLoading} onClick={() => setConsent.mutate(!on)}>
              {on ? t("circle.help.consent.turn_off", locale) : t("circle.help.consent.turn_on", locale)}
            </Button>
            {setConsent.isError && !notOpen ? <p role="alert" className="text-sm">{t("circle.help.consent.error", locale)}</p> : null}
          </section>
        </Disclosure>
      </CardContent>
    </Card>
  );
}
