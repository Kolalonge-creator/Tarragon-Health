"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t, type Locale } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPatientDateTime } from "@/lib/format-date";
import type { CallPolicy } from "@/lib/consultations/call-controller";
import type { CaregiverInvite } from "@/lib/consultations/caregivers";
import { respondCaregiverInviteAction } from "@/lib/consultations/actions";
import { useInAppCall } from "./use-in-app-call";

const POLL_MS = 10_000;
const when = (iso: string) => formatPatientDateTime(iso, { weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * CGJ: the room an invited caregiver joins from. It runs the SAME in-app call code as the patient and the clinician (useInAppCall), as a
 * guest: there is no link and no phone fallback (neither carries the key that ties a person to the invite), no fallback ladder (their
 * connection must never move the patient's call to audio only), and no chart anywhere on this page. When the in-app call is not
 * available the page says so honestly. The page refreshes while the call is live; if the care team removes the caregiver or the call ends,
 * the invite is gone from the next read and the page swaps to "not available", which also leaves the call.
 * `invite` is null when the person holds no usable invite for this call.
 */
export function CaregiverRoom({ invite, locale, call }: { invite: CaregiverInvite | null; locale: Locale; call: { policy: CallPolicy } | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [audioHint, setAudioHint] = useState(false);
  const callRoot = useRef<HTMLDivElement | null>(null);
  const inApp = useInAppCall(callRoot, {
    encounterId: invite?.encounter_id ?? "",
    role: "caregiver",
    policy: call?.policy ?? null,
    initialMode: invite?.final_media_mode === "audio_only" ? "audio_only" : "video",
    onPhone: () => undefined,
  });

  const refresh = useCallback(() => router.refresh(), [router]);
  const leaveInApp = inApp.leave;
  // Whenever the call stops while the guest was in it (they pressed Leave, or the call closed under them), say so: silence would leave a
  // guest unsure whether they were disconnected.
  const previous = useRef(inApp.state);
  useEffect(() => {
    if (previous.current === "in_call" && inApp.state === "idle") setNote(t("consult.cg.room_left", locale));
    previous.current = inApp.state;
  }, [inApp.state, locale]);
  const live = invite !== null;
  // The invite stops existing under a live call (removed, cancelled, call ended): leave at once, so nobody stays connected to a call
  // they are no longer allowed in.
  useEffect(() => {
    if (!live) void leaveInApp();
  }, [live, leaveInApp]);
  useEffect(() => {
    if (!live) return;
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [live, refresh]);

  function answer(accept: boolean) {
    if (!invite) return;
    setNote(null);
    startTransition(async () => {
      const r = await respondCaregiverInviteAction(invite.pass_id, accept);
      if (!r.ok) setNote(t("consult.cg.error", locale));
      refresh();
    });
  }

  function join(media: "video" | "audio_only") {
    setNote(null);
    startTransition(async () => {
      if (!call) {
        setNote(t("consult.cg.room_cannot_connect", locale));
        return;
      }
      const started = await inApp.start(media);
      if (started === "busy" || started === "cancelled") return;
      if (started === "started") {
        setAudioHint(media === "audio_only");
        refresh();
        return;
      }
      if (invite && started === "not_open") setNote(t("consult.cg.opens_at", locale, { when: when(invite.join_opens_at) }));
      else setNote(t("consult.cg.room_not_ready", locale));
    });
  }

  if (!invite) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("consult.cg.room_title", locale)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p role="status">{t("consult.cg.room_unavailable", locale)}</p>
          <Link href="/patient/supporting" className="font-medium text-brand-green underline">
            {t("consult.cg.back", locale)}
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("consult.cg.room_title", locale)}</CardTitle>
        <CardDescription>{t("consult.cg.invited_on", locale, { name: invite.patient_first_name, when: when(invite.scheduled_at) })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>{t("consult.cg.room_note", locale)}</p>
        <p>{t("consult.cg.room_note_scribe", locale)}</p>

        {invite.state === "invited" && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => answer(true)} disabled={pending}>
              {t("consult.cg.accept", locale)}
            </Button>
            <Button variant="outline" onClick={() => answer(false)} disabled={pending}>
              {t("consult.cg.decline", locale)}
            </Button>
          </div>
        )}

        {invite.state === "accepted" && (
          <div className="space-y-2">
            {!invite.joinable && inApp.state === "idle" && <p>{t("consult.cg.opens_at", locale, { when: when(invite.join_opens_at) })}</p>}
            {inApp.state === "joining" && <p role="status">{t("consult.call.loading", locale)}</p>}
            {/* Zoom draws its call into this box. It stays in the page at all times so the SDK has somewhere to render. */}
            <div ref={callRoot} data-testid="call-root" className={inApp.state === "idle" ? "hidden" : "min-h-[420px] w-full overflow-hidden rounded-md"} />
            {inApp.state !== "idle" && (
              <div className="space-y-2">
                {audioHint && <p>{t("consult.cg.audio_hint", locale)}</p>}
                <Button variant="outline" onClick={() => void inApp.leave()}>
                  {t("consult.call.leave", locale)}
                </Button>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => join("video")} disabled={pending || inApp.state !== "idle" || !invite.joinable || invite.final_media_mode === "audio_only"}>
                {t("consult.cg.join_video", locale)}
              </Button>
              <Button variant="outline" onClick={() => join("audio_only")} disabled={pending || inApp.state !== "idle" || !invite.joinable}>
                {t("consult.cg.join_audio", locale)}
              </Button>
            </div>
            {!call && <p>{t("consult.cg.room_cannot_connect", locale)}</p>}
          </div>
        )}

        {note && (
          <p role="alert" className="text-charcoal-ink dark:text-night-ink">
            {note}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
