"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useVideoConsultation } from "@/lib/queries/consult-slots";
import { useStartThread } from "@/lib/queries/care-messages";
import { useConsultationSummary } from "@/lib/queries/consultation-video";
import { submitConsultationPrep, type SubmitPrepState } from "../../video-visit-actions";
import { AppointmentPrepHelper } from "./appointment-prep-helper";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

import { formatPatientDateTime } from "@/lib/format-date";
/** 68.17 — the curated post-visit recap, once the care team has published
 * one. Nothing shows here until a clinician explicitly writes and publishes
 * it (publish_consultation_summary) — never an automatic dump of the
 * clinical note. */
function ConsultationSummaryCard({ consultationId }: { consultationId: string }) {
  const { data: summary, isLoading } = useConsultationSummary(consultationId);
  if (isLoading || !summary) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your visit summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-charcoal-ink">
        <div>
          <p className="text-xs font-medium text-charcoal-ink/50">What we discussed</p>
          <p>{summary.what_we_discussed}</p>
        </div>
        {summary.what_you_need_to_do && (
          <div>
            <p className="text-xs font-medium text-charcoal-ink/50">What you need to do</p>
            <p>{summary.what_you_need_to_do}</p>
          </div>
        )}
        {summary.medicines_note && (
          <div>
            <p className="text-xs font-medium text-charcoal-ink/50">Medicines</p>
            <p>{summary.medicines_note}</p>
          </div>
        )}
        {summary.tests_note && (
          <div>
            <p className="text-xs font-medium text-charcoal-ink/50">Tests</p>
            <p>{summary.tests_note}</p>
          </div>
        )}
        {summary.next_appointment_note && (
          <div>
            <p className="text-xs font-medium text-charcoal-ink/50">Next appointment</p>
            <p>{summary.next_appointment_note}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatSlot(iso: string): string {
  return formatPatientDateTime(iso, {
    weekday: "long",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Consultation System §9.6 device test — a real getUserMedia preview and a
 * live microphone level meter (Web Audio AnalyserNode), not a decorative
 * placeholder. Stops every track on unmount so the camera/mic light doesn't
 * stay on after the patient leaves this page.
 */
function DeviceTest() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  function stop() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setLevel(0);
  }

  useEffect(() => stop, []);

  async function startTest() {
    setStatus("testing");
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setLevel(Math.min(100, Math.round((avg / 128) * 100)));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();

      setStatus("ok");
    } catch {
      setStatus("error");
      setError("Couldn't reach your camera or microphone. Check your browser's permissions and try again.");
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-charcoal-ink">Test your camera & microphone</p>
      {status === "idle" && (
        <Button size="sm" variant="outline" onClick={startTest}>
          Start test
        </Button>
      )}
      {status === "testing" && <p className="text-sm text-charcoal-ink/60">Asking for permission…</p>}
      {status === "error" && (
        <div className="space-y-2">
          <p className="text-sm text-red-600">{error}</p>
          <Button size="sm" variant="outline" onClick={startTest}>
            Try again
          </Button>
        </div>
      )}
      {status === "ok" && (
        <div className="space-y-2">
          <video
            ref={videoRef}
            muted
            playsInline
            className="aspect-video w-full max-w-xs rounded-md bg-charcoal-ink/10"
          />
          <div>
            <p className="text-xs text-charcoal-ink/60">Microphone level</p>
            <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-charcoal-ink/10">
              <div
                className="h-full bg-brand-green transition-[width] duration-100"
                style={{ width: `${level}%` }}
              />
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={stop}>
            Stop test
          </Button>
        </div>
      )}
    </div>
  );
}

function ReportProblemButton({ consultationId, patientId }: { consultationId: string; patientId: string }) {
  const start = useStartThread();
  const [sent, setSent] = useState(false);
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");

  if (sent) {
    return <p className="text-sm text-charcoal-ink/70">Reported. Your care team will follow up in Messages.</p>;
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Report a technical problem
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <Textarea
        placeholder="What's going wrong? (e.g. camera won't turn on, can't hear the doctor)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={description.trim().length === 0 || start.isPending}
          onClick={() =>
            start.mutate(
              {
                subject: "Technical problem: video visit",
                body: `Consultation ${consultationId}: ${description.trim()}`,
                patientId,
              },
              { onSuccess: () => setSent(true) }
            )
          }
        >
          {start.isPending ? "Sending…" : "Send to care team"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {start.isError && <p className="text-xs text-red-600">{(start.error as Error).message}</p>}
    </div>
  );
}

export function VideoVisitWaitingRoom({
  consultationId,
  patientId,
}: {
  consultationId: string;
  patientId: string;
}) {
  const { data: consult, isLoading } = useVideoConsultation(consultationId);
  const [prepState, prepAction, prepPending] = useActionState<SubmitPrepState, FormData>(
    submitConsultationPrep,
    undefined
  );
  // Controlled (rather than the old defaultValue+key remount) so a
  // suggestion from AppointmentPrepHelper can be appended without touching
  // the save mechanism below -- still just plain text the patient can edit
  // freely before submitConsultationPrep saves it.
  const [notesValue, setNotesValue] = useState<string | null>(null);

  if (isLoading) return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  if (!consult) return <p className="text-sm text-charcoal-ink/60">Visit not found.</p>;

  const isCancelled = consult.status === "cancelled";
  const isPast = consult.status !== "scheduled";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Your video visit</CardTitle>
            <Badge variant={isCancelled ? "grey" : "green"}>
              {isCancelled ? "Cancelled" : consult.status === "completed" ? "Completed" : "Confirmed"}
            </Badge>
          </div>
          <CardDescription>
            {consult.scheduled_at ? formatSlot(consult.scheduled_at) : "Time to be confirmed"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-sm font-medium text-red-700">
              Not for emergencies. If this is an emergency, go to the nearest emergency department now.
            </p>
          </div>
          <p className="text-sm text-charcoal-ink/70">
            Join a few minutes early so there&apos;s time to sort out any camera or microphone issues
            before your doctor arrives.
          </p>
          {!isPast && consult.join_url && (
            <Button asChild>
              <a href={consult.join_url} target="_blank" rel="noreferrer">
                Join the call
              </a>
            </Button>
          )}
          {!isPast && !consult.join_url && (
            <p className="text-sm text-charcoal-ink/60">
              Your join link will appear here once it&apos;s ready. Check back closer to your visit.
            </p>
          )}
        </CardContent>
      </Card>

      {consult.status === "completed" && <ConsultationSummaryCard consultationId={consultationId} />}

      {!isPast && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Before you join</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <DeviceTest />

            <div className="space-y-2 border-t border-charcoal-ink/10 pt-3">
              <p className="text-sm font-medium text-charcoal-ink">
                What would you like to talk about? (optional)
              </p>
              <AppointmentPrepHelper
                consultationId={consultationId}
                onAddToNotes={(question) =>
                  setNotesValue((prev) => {
                    const base = prev ?? consult.patient_prep_notes ?? "";
                    return base.trim().length > 0 ? `${base}\n${question}` : question;
                  })
                }
              />
              <form action={prepAction} className="space-y-2">
                <input type="hidden" name="consultation_id" value={consultationId} />
                <Textarea
                  name="notes"
                  value={notesValue ?? consult.patient_prep_notes ?? ""}
                  onChange={(event) => setNotesValue(event.target.value)}
                  placeholder="Reason for the visit, symptoms, anything you want your doctor to know beforehand…"
                />
                <Button size="sm" variant="outline" type="submit" disabled={prepPending}>
                  {prepPending ? "Saving…" : "Save"}
                </Button>
                {prepState?.message && <p className="text-xs text-brand-green">{prepState.message}</p>}
                {prepState?.error && <p className="text-xs text-red-600">{prepState.error}</p>}
              </form>
            </div>

            <div className="space-y-2 border-t border-charcoal-ink/10 pt-3">
              <p className="text-sm font-medium text-charcoal-ink">Having connection trouble?</p>
              <p className="text-xs text-charcoal-ink/60">
                If your video keeps freezing, try turning your camera off and continuing on audio only.
                The call itself doesn&apos;t need video to work. If sound is unreliable too, end the call
                and your care team will follow up by phone instead.
              </p>
              <ReportProblemButton consultationId={consultationId} patientId={patientId} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
