"use client";

import { useEffect, useRef, useState } from "react";
import { t } from "@tarragon/i18n";
import { recordClinicianTime } from "@/lib/clinician/time-actions";
import { AUTO_FLUSH_SECONDS, VisibleTimer, manualMinutesToSeconds } from "@/lib/clinician/time-capture";

/**
 * W-01: counts the time this page is open and in front of the clinician (it pauses while the tab is hidden) and sends it for planning
 * only. Sending is best effort: a failure is silent and never blocks the work. It flushes when the tab is hidden, on a form submit
 * (so the time is in before a task is finished), on leaving, and every few minutes.
 */
export function TimeCapture({
  source,
  sourceRef,
  patientId,
  showNotice = true,
}: {
  source: "task" | "message";
  sourceRef: string;
  patientId: string;
  showNotice?: boolean;
}) {
  const timer = useRef<VisibleTimer | null>(null);

  useEffect(() => {
    const visible = () => document.visibilityState === "visible";
    const tm = new VisibleTimer(Date.now(), visible());
    timer.current = tm;
    const flush = () => {
      const seconds = tm.take(Date.now());
      if (seconds > 0) void recordClinicianTime({ source, sourceRef, patientId, seconds }).catch(() => undefined);
    };
    const onVisibility = () => {
      tm.setVisible(visible(), Date.now());
      if (!visible()) flush();
    };
    const every = window.setInterval(() => {
      if (tm.seconds(Date.now()) >= AUTO_FLUSH_SECONDS) flush();
    }, 30000);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("submit", flush, true);
    window.addEventListener("pagehide", flush);
    return () => {
      window.clearInterval(every);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("submit", flush, true);
      window.removeEventListener("pagehide", flush);
      tm.setVisible(false, Date.now());
      flush();
    };
  }, [source, sourceRef, patientId]);

  if (!showNotice) return null;
  return <p className="text-xs text-charcoal-ink/60">{t("time.task_footer", "en")}</p>;
}

/** Time spent on this patient away from the page (a call, reading a report on paper). Whole minutes, up to four hours. */
export function ManualTimeForm({ patientId }: { patientId: string }) {
  const [minutes, setMinutes] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed" | "invalid">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const seconds = manualMinutesToSeconds(minutes);
    if (seconds === null) {
      setState("invalid");
      return;
    }
    setState("saving");
    const res = await recordClinicianTime({ source: "manual", sourceRef: null, patientId, seconds }).catch(() => ({ ok: false }));
    setState(res.ok ? "saved" : "failed");
    if (res.ok) setMinutes("");
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 text-sm" data-testid="manual-time-form">
      <label htmlFor="manual-minutes" className="text-charcoal-ink/70">{t("time.manual_label", "en")}</label>
      <input
        id="manual-minutes"
        inputMode="decimal"
        value={minutes}
        onChange={(e) => setMinutes(e.target.value)}
        className="w-20 rounded-md border border-charcoal-ink/20 px-2 py-1"
      />
      <button type="submit" disabled={state === "saving"} className="rounded-md border border-charcoal-ink/20 px-3 py-1">
        {t("time.manual_button", "en")}
      </button>
      {state === "saved" && <span role="status" className="text-brand-green">{t("time.manual_saved", "en")}</span>}
      {state === "invalid" && <span role="alert" className="text-red-600">{t("time.manual_invalid", "en")}</span>}
      {state === "failed" && <span role="alert" className="text-red-600">{t("time.manual_failed", "en")}</span>}
    </form>
  );
}
