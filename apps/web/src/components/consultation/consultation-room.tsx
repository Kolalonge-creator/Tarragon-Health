"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t, type Locale } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPatientDateTime } from "@/lib/format-date";
import {
  answerScribeConsentAction,
  completeConsultationAction,
  joinConsultationAction,
  reportNoShowAction,
  requestPhoneAction,
} from "@/lib/consultations/actions";

/** What consultation_room_view() returns. Nothing in it is a name, a link or a reading. */
export interface RoomView {
  encounter_id: string;
  role: "patient" | "clinician";
  status: "scheduled" | "waiting" | "in_progress" | "completed" | "no_show_patient" | "no_show_clinician" | "cancelled" | "failed";
  scheduled_at: string;
  final_media_mode: "video" | "audio_only" | "phone" | null;
  join_opens_at: string;
  joinable: boolean;
  patient_joined: boolean;
  clinician_joined: boolean;
  scribe: { asked: boolean; granted: boolean | null };
  can_report_clinician_absent: boolean;
  can_report_patient_absent: boolean;
  clinician_wait_minutes: number;
  reconnect_grace_seconds: number;
}

const LIVE = new Set(["scheduled", "waiting", "in_progress"]);
const POLL_MS = 10_000;
const when = (iso: string) => formatPatientDateTime(iso, { weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * The consultation room (S21). The call itself runs in the vendor's own app or tab (OQ-126); this page is the app-side waiting
 * room: it asks the scribe consent question, opens the person's own link, offers audio only and the phone fallback, and lets
 * either side say the other did not come. It never shows or stores a link, and refreshes itself while the consultation is live.
 */
export function ConsultationRoom({ view, locale }: { view: RoomView; locale: Locale }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [audioHint, setAudioHint] = useState(false);
  // The person's own link, held in memory only for this page view (never stored). Browsers block a popup opened after an awaited
  // call, so the link is also offered as a plain link the person can tap.
  const [callUrl, setCallUrl] = useState<string | null>(null);
  const live = LIVE.has(view.status);
  const isPatient = view.role === "patient";

  const refresh = useCallback(() => router.refresh(), [router]);
  useEffect(() => {
    if (!live) return;
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [live, refresh]);

  function join(media: "video" | "audio_only") {
    setNote(null);
    startTransition(async () => {
      const res = await joinConsultationAction(view.encounter_id, media);
      if (res.ok && "url" in res) {
        setAudioHint(res.mediaMode === "audio_only");
        setCallUrl(res.url);
        window.open(res.url, "_blank", "noopener,noreferrer");
        refresh();
      } else if (!res.ok && res.reason === "not_open") {
        setNote(t("consult.room.not_open", locale, { when: when(view.join_opens_at) }));
      } else if (!res.ok && res.reason === "on_phone") {
        setNote(t("consult.room.phone_moving", locale));
      } else {
        setNote(t("consult.room.link_error", locale));
      }
    });
  }

  function phone() {
    setNote(null);
    startTransition(async () => {
      const res = await requestPhoneAction(view.encounter_id);
      setNote(res.ok ? t("consult.room.phone_moving", locale) : t("consult.room.link_error", locale));
      refresh();
    });
  }

  function absent() {
    setNote(null);
    startTransition(async () => {
      const res = await reportNoShowAction(view.encounter_id);
      if (!res.ok) setNote(res.reason === "wait_longer" ? t("consult.room.wait_longer", locale) : t("consult.room.save_error", locale));
      refresh();
    });
  }

  function scribe(granted: boolean) {
    startTransition(async () => {
      const res = await answerScribeConsentAction(view.encounter_id, granted);
      // A failed save must never look like a saved answer: say so, and keep the question on screen.
      if (!res.ok) setNote(t("consult.room.save_error", locale));
      refresh();
    });
  }

  function finish() {
    startTransition(async () => {
      const res = await completeConsultationAction(view.encounter_id);
      if (!res.ok) setNote(t("consult.room.save_error", locale));
      refresh();
    });
  }

  if (!live) {
    const text = view.status === "completed" ? t("consult.room.ended", locale) : view.status === "cancelled" ? t("consult.room.cancelled", locale) : t("consult.room.ended", locale);
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("consult.room.title", locale)}</CardTitle>
          <CardDescription>{when(view.scheduled_at)}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm">{text}</CardContent>
      </Card>
    );
  }

  const otherJoined = isPatient ? view.clinician_joined : view.patient_joined;
  const canReportAbsent = isPatient ? view.can_report_clinician_absent : view.can_report_patient_absent;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("consult.room.title", locale)}</CardTitle>
          <CardDescription>{t("consult.room.when", locale, { when: when(view.scheduled_at) })}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p role="status" aria-live="polite">
            {isPatient
              ? otherJoined
                ? t("consult.room.connected", locale)
                : t("consult.room.waiting", locale)
              : otherJoined
                ? t("consult.room.connected_patient", locale)
                : t("consult.room.waiting_patient", locale)}
          </p>
          {view.final_media_mode === "audio_only" && <p>{t("consult.room.mode_audio", locale)}</p>}
          {!view.joinable && <p>{t("consult.room.not_open", locale, { when: when(view.join_opens_at) })}</p>}
          {audioHint && <p>{t("consult.room.audio_hint", locale)}</p>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => join("video")} disabled={pending || !view.joinable || view.final_media_mode === "audio_only"}>
              {t("consult.room.join_video", locale)}
            </Button>
            <Button variant="outline" onClick={() => join("audio_only")} disabled={pending || !view.joinable}>
              {t("consult.room.join_audio", locale)}
            </Button>
          </div>
          {callUrl && (
            <p>
              {t("consult.room.open_call_hint", locale)}{" "}
              <a href={callUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-green underline">
                {t("consult.room.open_call", locale)}
              </a>
            </p>
          )}
          {note && (
            <p role="alert" className="text-charcoal-ink dark:text-night-ink">
              {note}
            </p>
          )}
        </CardContent>
      </Card>

      {isPatient && view.scribe.granted === null && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("consult.scribe.title", locale)}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>{t("consult.scribe.body", locale)}</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => scribe(true)} disabled={pending}>
                {t("consult.scribe.allow", locale)}
              </Button>
              <Button variant="outline" onClick={() => scribe(false)} disabled={pending}>
                {t("consult.scribe.decline", locale)}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {isPatient && view.scribe.granted !== null && (
        <Card>
          <CardContent className="space-y-2 pt-4 text-sm">
            <p>{t("consult.scribe.saved", locale)}</p>
            {view.scribe.granted && (
              <Button variant="outline" onClick={() => scribe(false)} disabled={pending}>
                {t("consult.scribe.withdraw", locale)}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-2 pt-4 text-sm">
          <p>{isPatient ? t("consult.room.call_me_hint", locale) : t("consult.room.call_both_hint", locale)}</p>
          <Button variant="outline" onClick={phone} disabled={pending}>
            {t("consult.room.call_me", locale)}
          </Button>
        </CardContent>
      </Card>

      {canReportAbsent && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{isPatient ? t("consult.room.nobody_came", locale) : t("consult.room.nobody_came_action", locale)}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {isPatient && <p>{t("consult.room.nobody_came_hint", locale, { minutes: view.clinician_wait_minutes })}</p>}
            <Button variant="outline" onClick={absent} disabled={pending}>
              {t("consult.room.nobody_came_action", locale)}
            </Button>
          </CardContent>
        </Card>
      )}

      {!isPatient && view.status === "in_progress" && (
        <div className="space-y-2 text-sm">
          <p>{t("consult.room.finish_hint", locale)}</p>
          <Button onClick={finish} disabled={pending}>
            {t("consult.room.finish", locale)}
          </Button>
        </div>
      )}
    </div>
  );
}
