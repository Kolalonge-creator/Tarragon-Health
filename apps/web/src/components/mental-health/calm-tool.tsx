"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  advancePanic, groundingKey, initialPanicState, panicBreathView, panicCircleScale, panicSteppedScale, panicToolConfig, type PanicState,
} from "@tarragon/shared";
import { t, type MessageKey } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/client";
import { CrisisCard } from "@/components/mental-health/crisis-card";

/**
 * The calm tool (S56b, function 4): one tap from the wellbeing home and the check-in opens a full-screen, scripted exercise for acute anxiety.
 *
 * Offline: every word comes from the bundled catalogue and every step from pure code in @tarragon/shared, so once this page is open the exercise
 * needs no network and no account data. The ONLY network calls are the ones the person starts: "Tell my care team" (the existing hand-off) and the
 * crisis card, which falls back to its bundled copy. Nothing is logged, counted or sent unless the person taps "Tell my care team".
 *
 * The way out to the crisis card ("I am in danger or thinking of harming myself") is on screen at every step and is not behind any flag.
 * No model, no sound, no analytics. Reduced motion (or the words-only switch) removes the moving circle; the words alone carry the exercise.
 */
const tr = (key: string, params?: Record<string, string | number>) => t(key as MessageKey, "en", params);

function subscribeReducedMotion(cb: () => void): () => void {
  try {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    m.addEventListener("change", cb);
    return () => m.removeEventListener("change", cb);
  } catch {
    return () => undefined;
  }
}
function readReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

const BIG = "min-h-14 w-full rounded-xl px-5 py-3 text-lg font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-green/50";
const PRIMARY = `${BIG} bg-brand-green text-white`;
const SECONDARY = `${BIG} border-2 border-brand-green text-brand-green dark:text-brand-green-bright bg-transparent`;

export function CalmToolButton({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  if (!enabled) return null;
  return (
    <div className="space-y-1">
      <button ref={opener} type="button" onClick={() => setOpen(true)} className={`${PRIMARY} flex flex-col items-center`} aria-haspopup="dialog">
        <span>{tr("panic.button")}</span>
      </button>
      <p className="text-center text-xs text-charcoal-ink/65 dark:text-night-ink/65">{tr("panic.button_hint")}</p>
      {open && <CalmToolDialog onClose={() => { setOpen(false); opener.current?.focus(); }} />}
    </div>
  );
}

function CalmToolDialog({ onClose }: { onClose: () => void }) {
  const cfg = panicToolConfig();
  const [state, setState] = useState<PanicState>(initialPanicState());
  const [elapsed, setElapsed] = useState(0);
  const [help, setHelp] = useState(false);
  const [textOverride, setTextOverride] = useState<boolean | null>(null);
  const [told, setTold] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false);
  const textOnly = textOverride ?? reducedMotion;
  const startedAt = useRef(0);
  const root = useRef<HTMLDivElement>(null);

  const dispatch = useCallback((e: Parameters<typeof advancePanic>[1]) => setState((s) => advancePanic(s, e, cfg)), [cfg]);

  // The breathing clock only runs while the guide is on screen (not while the help card is open).
  useEffect(() => {
    if (state.stage !== "breathing" || help) return;
    startedAt.current = Date.now() - elapsed * 1000;
    const id = window.setInterval(() => {
      const e = (Date.now() - startedAt.current) / 1000;
      setElapsed(e);
      if (panicBreathView(e, cfg).done) dispatch("breathing_finished");
    }, 200);
    return () => window.clearInterval(id);
    // elapsed is deliberately read once at (re)start so a pause for the help card resumes where it stopped
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.stage, help, cfg, dispatch]);

  // Focus the dialog on open, lock page scroll, close on Escape, keep Tab inside.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    root.current?.focus();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") { onClose(); return; }
      if (ev.key !== "Tab" || !root.current) return;
      const f = Array.from(root.current.querySelectorAll<HTMLElement>("button, [href], input, [tabindex]:not([tabindex='-1'])")).filter((n) => !n.hasAttribute("disabled"));
      if (f.length === 0) return;
      const first = f[0] as HTMLElement;
      const last = f[f.length - 1] as HTMLElement;
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  async function tellTeam() {
    setTold("sending");
    try {
      const { error } = await createClient().rpc("request_mental_health_handoff", { p_note: tr("panic.tell_team_note") });
      setTold(error ? "error" : "sent");
    } catch {
      setTold("error");
    }
  }

  const view = panicBreathView(elapsed, cfg);
  const scale = textOnly ? panicSteppedScale(view.phase) : panicCircleScale(view);
  const phaseWord = view.phase === "inhale" ? tr("panic.breathe_in") : view.phase === "exhale" ? tr("panic.breathe_out") : "";

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={tr("panic.dialog_label")}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col bg-white text-charcoal-ink dark:bg-night-ground dark:text-night-ink outline-none"
    >
      <div className="flex items-center justify-between gap-3 border-b border-charcoal-ink/10 px-4 py-3 dark:border-night-ink/15">
        <p className="text-xs text-charcoal-ink/65 dark:text-night-ink/65">{tr("panic.not_saved")}</p>
        <button type="button" onClick={onClose} className="min-h-12 shrink-0 rounded-lg border-2 border-charcoal-ink/30 px-4 text-base font-semibold dark:border-night-ink/40">
          {tr("panic.close")}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-6">
        <div className="mx-auto flex max-w-md flex-col items-center gap-6 text-center">
          {help ? (
            <div className="w-full space-y-4 text-left">
              <CrisisCard />
              <button type="button" onClick={() => setHelp(false)} className={SECONDARY}>{tr("panic.danger_back")}</button>
            </div>
          ) : (
            <>
              <h2 className="text-2xl font-semibold">{state.stage === "done" ? tr("panic.done_title") : tr("panic.title")}</h2>

              {state.stage === "intro" && (
                <>
                  <p className="text-lg">{tr("panic.intro_1")}</p>
                  <p className="text-lg">{tr("panic.intro_2")}</p>
                  <label className="flex items-center gap-2 text-base">
                    <input type="checkbox" className="h-6 w-6" checked={textOnly} onChange={(e) => setTextOverride(e.target.checked)} />
                    {tr("panic.text_mode")}
                  </label>
                  <button type="button" onClick={() => dispatch("start")} className={PRIMARY} autoFocus>{tr("panic.start")}</button>
                </>
              )}

              {state.stage === "breathing" && (
                <>
                  {!textOnly && (
                    <div
                      aria-hidden="true"
                      className="h-52 w-52 rounded-full border-4 border-brand-green bg-brand-green/20"
                      style={{ transform: `scale(${scale})`, transition: "transform 200ms linear" }}
                    />
                  )}
                  <p className="text-2xl font-semibold" aria-live="polite">{phaseWord}</p>
                  <p className="text-4xl tabular-nums" aria-hidden="true">{view.secondsLeft}</p>
                  <p className="text-base text-charcoal-ink/70 dark:text-night-ink/70">{tr("panic.breath_count", { n: view.breath, total: view.totalBreaths })}</p>
                  <button type="button" onClick={() => dispatch("skip")} className={SECONDARY}>{tr("panic.skip")}</button>
                </>
              )}

              {state.stage === "grounding" && (
                <>
                  {state.step === 0 && <p className="text-lg">{tr("panic.ground_intro")}</p>}
                  <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{tr("panic.step_of", { n: state.step + 1, total: cfg.grounding_counts.length })}</p>
                  <p className="text-2xl font-semibold" aria-live="polite">{tr(groundingKey(cfg.grounding_counts[state.step] ?? 1))}</p>
                  <button type="button" onClick={() => dispatch("next")} className={PRIMARY} autoFocus>{tr("panic.next")}</button>
                </>
              )}

              {state.stage === "done" && (
                <>
                  <p className="text-lg">{tr("panic.done_line")}</p>
                  <button type="button" onClick={() => { setElapsed(0); dispatch("restart"); }} className={PRIMARY}>{tr("panic.again")}</button>
                  {told === "sent" ? (
                    <p role="status" className="text-base font-medium">{tr("panic.tell_team_sent")}</p>
                  ) : (
                    <button type="button" onClick={tellTeam} disabled={told === "sending"} className={SECONDARY}>
                      {told === "sending" ? tr("panic.tell_team_sending") : tr("panic.tell_team")}
                    </button>
                  )}
                  {told === "error" && <p role="alert" className="text-base text-red-700 dark:text-red-400">{tr("panic.tell_team_error")}</p>}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {!help && (
        <div className="border-t border-red-300 bg-red-50 px-4 py-3 dark:border-red-500/40 dark:bg-red-950/40">
          <button type="button" onClick={() => setHelp(true)} className="min-h-14 w-full rounded-xl bg-red-700 px-4 py-3 text-lg font-semibold text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-400">
            {tr("panic.danger")}
          </button>
          <p className="mt-1 text-center text-xs text-charcoal-ink/70 dark:text-night-ink/70">{tr("panic.danger_hint")}</p>
        </div>
      )}
    </div>
  );
}
