"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatWaiting, nextPollMs, pagesNeedingAction } from "@/lib/paging/alarm";
import { activePagesSchema, type ActivePage } from "@/lib/paging/schemas";

const SOUND_KEY = "tarragon.oncall.sound";

function readSoundPreference(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) === "on";
  } catch {
    return false;
  }
}

function writeSoundPreference(on: boolean): void {
  try {
    window.localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    // private window or blocked storage: the banner still works, the tone just is not remembered
  }
}

/** One short two-tone beep. Browsers only allow audio after a click, so this runs only once the clinician has switched the sound on. */
function beep(ctx: AudioContext): void {
  const now = ctx.currentTime;
  [880, 660].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + i * 0.25);
    gain.gain.exponentialRampToValueAtTime(0.25, now + i * 0.25 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.25 + 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + i * 0.25);
    osc.stop(now + i * 0.25 + 0.24);
  });
}

/**
 * The in-console alarm (S19, spec 7.9 step 2, D-12): a banner on every clinician page while a red event page waits, with a
 * repeating tone the clinician switches on once. It asks the database (my_active_pages, which only ever returns the caller's
 * own pages) every few seconds. If the check fails the banner says so rather than looking like "nothing is waiting".
 * Push and email go out as well, so this is one of three ways a page reaches a person, never the only one.
 */
export function OnCallAlarm() {
  const [pages, setPages] = useState<ActivePage[]>([]);
  const [failed, setFailed] = useState(false);
  // read once on first render; nothing is drawn on the server (no pages yet), so there is no hydration mismatch to guard
  const [sound, setSound] = useState<boolean>(() => typeof window !== "undefined" && readSoundPreference());
  const audioRef = useRef<AudioContext | null>(null);
  const waiting = pagesNeedingAction(pages);

  const latest = useRef<ActivePage[]>([]);

  const poll = useCallback(async () => {
    // the generated types do not carry the S19 functions yet; the answer is parsed with Zod below, never trusted
    const client = createClient() as unknown as { rpc: (fn: string) => PromiseLike<{ data: unknown; error: { message: string } | null }> };
    const { data, error } = await client.rpc("my_active_pages");
    const parsed = error ? null : activePagesSchema.safeParse(data);
    if (!parsed?.success) {
      setFailed(true);
      return;
    }
    setFailed(false);
    latest.current = parsed.data;
    setPages(parsed.data);
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (document.visibilityState === "visible") await poll();
      if (!stopped) timer = setTimeout(() => void tick(), nextPollMs(pagesNeedingAction(latest.current).length > 0));
    };
    void tick();
    const onFocus = () => void poll();
    window.addEventListener("focus", onFocus);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [poll]);

  useEffect(() => {
    if (!sound || waiting.length === 0) return;
    const ctx = audioRef.current ?? new AudioContext();
    audioRef.current = ctx;
    void ctx.resume();
    beep(ctx);
    const t = setInterval(() => beep(ctx), 3000);
    return () => clearInterval(t);
  }, [sound, waiting.length]);

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    writeSoundPreference(next);
    if (next) {
      const ctx = audioRef.current ?? new AudioContext();
      audioRef.current = ctx;
      void ctx.resume();
      beep(ctx);
    }
  };

  if (failed && waiting.length === 0) {
    return (
      <div role="status" className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-100">
        We could not check for priority cases just now. Push and email will still reach you. Open the On call page if you are unsure.
      </div>
    );
  }
  if (waiting.length === 0) return null;
  const oldest = Math.max(...waiting.map((p) => p.seconds_waiting));
  return (
    <div role="alert" aria-live="assertive" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border-2 border-red-600 bg-red-50 px-4 py-3 text-red-900 dark:bg-red-500/15 dark:text-red-100">
      <div className="text-sm">
        <strong>{waiting.length === 1 ? "A priority case is waiting for you." : `${waiting.length} priority cases are waiting.`}</strong>{" "}
        Longest wait {formatWaiting(oldest)}.
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={toggleSound} className="h-9 rounded-md border border-red-700 px-3 text-sm font-medium">
          {sound ? "Turn sound off" : "Turn alarm sound on"}
        </button>
        <Link href="/clinician/on-call" className="inline-flex h-9 items-center rounded-md bg-red-700 px-3 text-sm font-medium text-white">
          Open On call
        </Link>
      </div>
    </div>
  );
}
