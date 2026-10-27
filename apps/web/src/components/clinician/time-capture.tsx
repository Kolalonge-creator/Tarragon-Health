"use client";

import { useEffect, useRef, useState } from "react";
import { t } from "@tarragon/i18n";
import { recordClinicianTime } from "@/lib/clinician/time-actions";
import { MAX_MANUAL_MINUTES, manualMinutesToSeconds, manualNeedsConfirm, type TimeEntryInput } from "@/lib/clinician/time-capture";
import { attachTimeCapture, createTimeCaptureController, type TimeSink } from "@/lib/clinician/time-capture-controller";

const sink: TimeSink = {
  beacon(entry: TimeEntryInput): boolean {
    try {
      const body = new Blob([JSON.stringify(entry)], { type: "application/json" });
      return typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function" ? navigator.sendBeacon("/api/clinician/time", body) : false;
    } catch {
      return false;
    }
  },
  action: (entry) => recordClinicianTime(entry),
};

/**
 * W-01: counts the time this surface is open, in front of the clinician and in use (it pauses while the tab is hidden, after two minutes with
 * no input, and while another surface on the page has the focus) and sends it for planning only. Sending is best effort: a failure is silent
 * and never blocks the work, and the last seconds go by beacon so they survive the page closing. `active` lets a page with several of these
 * (expanded message threads) count only the one in focus.
 */
export function TimeCapture({
  source,
  sourceRef,
  patientId,
  showNotice = true,
  active = true,
}: {
  source: "task" | "message";
  sourceRef: string;
  patientId: string;
  showNotice?: boolean;
  active?: boolean;
}) {
  const activeRef = useRef(active);
  const controllerRef = useRef<ReturnType<typeof createTimeCaptureController> | null>(null);

  useEffect(() => {
    const controller = createTimeCaptureController({
      source,
      sourceRef,
      patientId,
      now: () => Date.now(),
      sink,
      newKey: () => crypto.randomUUID(),
      active: document.visibilityState === "visible" && activeRef.current,
    });
    controllerRef.current = controller;
    const detach = attachTimeCapture(document, window, controller, () => activeRef.current);
    return () => {
      detach();
      controller.finish();
      controllerRef.current = null;
    };
  }, [source, sourceRef, patientId]);

  useEffect(() => {
    activeRef.current = active;
    controllerRef.current?.setActive(document.visibilityState === "visible" && active);
  }, [active]);

  if (!showNotice) return null;
  return <p className="text-xs text-charcoal-ink/60">{t("time.task_footer", "en")}</p>;
}

/** Time spent on this patient away from the page (a call, reading a report on paper). Up to 120 minutes; above 60 it asks to confirm. */
export function ManualTimeForm({ patientId }: { patientId: string }) {
  const [minutes, setMinutes] = useState("");
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed" | "invalid">("idle");
  const keyRef = useRef<string | null>(null);

  async function send(raw: string) {
    const seconds = manualMinutesToSeconds(raw);
    if (seconds === null) {
      setState("invalid");
      return;
    }
    setState("saving");
    keyRef.current = keyRef.current ?? crypto.randomUUID();
    const res = await recordClinicianTime({ source: "manual", sourceRef: null, patientId, seconds, clientKey: keyRef.current }).catch(() => ({ ok: false }));
    setState(res.ok ? "saved" : "failed");
    if (res.ok) {
      setMinutes("");
      setNeedsConfirm(false);
      keyRef.current = null;
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (manualMinutesToSeconds(minutes) === null) {
      setState("invalid");
      return;
    }
    if (manualNeedsConfirm(minutes) && !needsConfirm) {
      setNeedsConfirm(true);
      return;
    }
    await send(minutes);
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 text-sm" data-testid="manual-time-form">
      <label htmlFor="manual-minutes" className="text-charcoal-ink/70">{t("time.manual_label", "en")}</label>
      <input
        id="manual-minutes"
        inputMode="decimal"
        value={minutes}
        onChange={(e) => {
          setMinutes(e.target.value);
          setNeedsConfirm(false);
          keyRef.current = null;
        }}
        className="w-20 rounded-md border border-charcoal-ink/20 px-2 py-1"
      />
      <button type="submit" disabled={state === "saving"} className="rounded-md border border-charcoal-ink/20 px-3 py-1">
        {needsConfirm ? t("time.manual_confirm_button", "en") : t("time.manual_button", "en")}
      </button>
      {needsConfirm && <span role="status" className="text-charcoal-ink/70">{t("time.manual_confirm", "en", { minutes })}</span>}
      {state === "saved" && <span role="status" className="text-brand-green">{t("time.manual_saved", "en")}</span>}
      {state === "invalid" && <span role="alert" className="text-red-600">{t("time.manual_invalid", "en", { max: MAX_MANUAL_MINUTES })}</span>}
      {state === "failed" && <span role="alert" className="text-red-600">{t("time.manual_failed", "en")}</span>}
    </form>
  );
}
