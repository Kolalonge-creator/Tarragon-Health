"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t, type Locale } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPatientDateTime } from "@/lib/format-date";
import type { DialIn } from "@tarragon/integrations";
import type { CallNotice, CallPolicy } from "@/lib/consultations/call-controller";
import { useInAppCall } from "./use-in-app-call";
import {
  answerScribeConsentAction,
  completeConsultationAction,
  joinConsultationAction,
  reportNoShowAction,
  requestDialInAction,
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
export function ConsultationRoom({ view, locale, call = null }: { view: RoomView; locale: Locale; call?: { policy: CallPolicy } | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [audioHint, setAudioHint] = useState(false);
  // The person's own link, held in memory only for this page view (never stored). Browsers block a popup opened after an awaited
  // call, so the link is also offered as a plain link the person can tap.
  const [callUrl, setCallUrl] = useState<string | null>(null);
  // The phone numbers and passcode for this call, held in memory for this page view only (never stored, never logged).
  const [dialIn, setDialIn] = useState<Pick<DialIn, "numbers" | "meetingId" | "passcode"> | null>(null);
  const live = LIVE.has(view.status);
  const isPatient = view.role === "patient";
  // The in-app call (S21 follow-up). Absent unless the server says the Meeting SDK is configured; every failure falls back to the link.
  const callRoot = useRef<HTMLDivElement | null>(null);
  const inApp = useInAppCall(callRoot, {
    encounterId: view.encounter_id,
    role: view.role,
    policy: call?.policy ?? null,
    initialMode: view.final_media_mode,
    onPhone: () => phone(),
  });

  const refresh = useCallback(() => router.refresh(), [router]);
  useEffect(() => {
    if (!live) return;
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [live, refresh]);

  function join(media: "video" | "audio_only") {
    setNote(null);
    startTransition(async () => {
      if (call) {
        const started = await inApp.start(media);
        if (started === "started") {
          setAudioHint(media === "audio_only");
          refresh();
          return;
        }
        if (started === "not_open") {
          setNote(t("consult.room.not_open", locale, { when: when(view.join_opens_at) }));
          return;
        }
        // Could not run inside the app: say so, then open the link as before.
        setNote(t("consult.call.fallback_link", locale));
      }
      const res = await joinConsultationAction(view.encounter_id, media);
      if (res.ok && "url" in res) {
        setAudioHint(res.mediaMode === "audio_only");
        setCallUrl(res.url);
        window.open(res.url, "_blank", "noopener,noreferrer");
        refresh();
      } else if (!res.ok && res.reason === "not_open") {
        setNote(t("consult.room.not_open", locale, { when: when(view.join_opens_at) }));
      } else {
        setNote(t("consult.room.link_error", locale));
      }
    });
  }

  function phone() {
    setNote(null);
    startTransition(async () => {
      const res = await requestDialInAction(view.encounter_id);
      if (res.ok && "dialIn" in res) {
        setDialIn(res.dialIn);
      } else if (!res.ok && res.reason === "not_open") {
        setNote(t("consult.room.phone_not_open", locale, { when: when(view.join_opens_at) }));
      } else if (!res.ok && res.reason === "phone_unavailable") {
        setNote(t("consult.room.phone_unavailable", locale));
      } else {
        setNote(t("consult.room.link_error", locale));
      }
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
          {call && (
            <div className="space-y-2">
              {inApp.state === "joining" && <p role="status">{t("consult.call.loading", locale)}</p>}
              {inApp.notice && (
                <p role="status" aria-live="polite" data-testid="call-notice">
                  {callNoticeText(inApp.notice, locale, view.reconnect_grace_seconds)}
                </p>
              )}
              {inApp.notice === "offer_video" && (
                <Button variant="outline" onClick={inApp.takeVideo}>
                  {t("consult.call.take_video", locale)}
                </Button>
              )}
              {/* Zoom draws its call into this box. It stays in the page at all times so the SDK has somewhere to render. */}
              <div ref={callRoot} data-testid="call-root" className={inApp.state === "idle" ? "hidden" : "min-h-[420px] w-full overflow-hidden rounded-md"} />
              {inApp.state === "in_call" && (
                <div className="space-y-2">
                  <p>{t("consult.call.camera_hint", locale)}</p>
                  <Button variant="outline" onClick={() => void inApp.leave()}>
                    {t("consult.call.leave", locale)}
                  </Button>
                </div>
              )}
            </div>
          )}
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
          <Button variant="outline" onClick={phone} disabled={pending || !view.joinable}>
            {t("consult.room.call_me", locale)}
          </Button>
          {dialIn && dialIn.numbers[0] && (
            <div className="space-y-2" data-testid="dial-in">
              <p>
                {t(dialIn.passcode ? "consult.room.phone_steps" : "consult.room.phone_steps_nocode", locale, {
                  number: dialIn.numbers[0].number,
                  id: dialIn.meetingId,
                  code: dialIn.passcode ?? "",
                })}
              </p>
              <a href={`tel:${dialIn.numbers[0].number.replace(/[^+\d]/g, "")}`} className="font-medium text-brand-green underline">
                {dialIn.numbers[0].number}
              </a>
              {dialIn.numbers.length > 1 && (
                <p>
                  {t("consult.room.phone_more_numbers", locale)}{" "}
                  {dialIn.numbers.slice(1).map((n) => n.number).join(", ")}
                </p>
              )}
              <p>{t("consult.room.phone_cost", locale)}</p>
            </div>
          )}
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

function callNoticeText(notice: CallNotice, locale: Locale, graceSeconds: number): string {
  switch (notice) {
    case "audio_only":
      return t("consult.call.audio_only_notice", locale);
    case "offer_video":
      return t("consult.call.offer_video", locale);
    case "video_back":
      return t("consult.call.video_back", locale);
    case "held_place":
      return t("consult.call.held_place", locale, { seconds: graceSeconds });
    case "reconnected":
      return t("consult.call.reconnected", locale);
    case "phone":
      return t("consult.call.phone_notice", locale);
    case "report_failed":
      return t("consult.call.report_failed", locale);
  }
}
