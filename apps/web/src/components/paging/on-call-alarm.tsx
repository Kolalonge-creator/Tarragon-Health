"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatWaiting, nextPollMs, pagesNeedingAction } from "@/lib/paging/alarm";
import { activePagesSchema, type ActivePage } from "@/lib/paging/schemas";

const SOUND_KEY = "tarragon.oncall.sound";
const DEVICE_KEY = "tarragon.oncall.device";
/** How often this console tells the server it is alive (the on-call device last-seen, S19c). */
const PING_EVERY_MS = 60_000;

/** A stable random id for this browser, so the server can tell consoles apart. Not an identity: no personal data. */
export function deviceId(): string {
  try {
    const existing = window.localStorage.getItem(DEVICE_KEY);
    if (existing && existing.length >= 8) return existing;
    const fresh = `web-${crypto.randomUUID()}`;
    window.localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    return `web-session-${Math.random().toString(36).slice(2, 12)}`;
  }
}

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
  const shown = useRef<Set<string>>(new Set());
  const lastPing = useRef(0);

  const poll = useCallback(async () => {
    // the generated types do not carry the S19 functions yet; the answer is parsed with Zod below, never trusted
    const client = createClient() as unknown as {
      rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
    };
    const { data, error } = await client.rpc("my_active_pages");
    const parsed = error ? null : activePagesSchema.safeParse(data);
    if (!parsed?.success) {
      setFailed(true);
      return;
    }
    setFailed(false);
    latest.current = parsed.data;
    setPages(parsed.data);

    // S19c (decision 9): tell the server this page is actually on screen. Only pages sent to this clinician (not the level 2
    // lead alert) and only once per page per tab; a failure is ignored, the next poll tries again. The server uses the receipt to
    // advance the ladder early when a page is never shown.
    const id = deviceId();
    for (const p of pagesNeedingAction(parsed.data)) {
      if (p.role === "escalation" || p.delivered_at !== null || shown.current.has(p.page_id)) continue;
      shown.current.add(p.page_id);
      const res = await client.rpc("record_page_delivered", { p_ref: p.page_id, p_channel: "alarm", p_device: id });
      if (res.error) shown.current.delete(p.page_id);
    }
    // device last-seen, about once a minute while the console is open and visible
    if (Date.now() - lastPing.current >= PING_EVERY_MS) {
      lastPing.current = Date.now();
      await client.rpc("paging_device_ping", { p_device: id, p_kind: "web" });
    }
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
  const expired = waiting.some((p) => p.expired_at !== null);
  if (expired) {
    // S19c: the whole ladder ran out. A different, louder banner for the lead and ops: the next step is a phone call, not a tap.
    return (
      <div role="alert" aria-live="assertive" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border-4 border-red-700 bg-red-100 px-4 py-3 text-red-950 dark:bg-red-500/25 dark:text-red-50">
        <div className="text-sm">
          <strong>Nobody has answered a priority case.</strong> Every alert has gone out. Phone the clinician on call now. Longest wait {formatWaiting(oldest)}.
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
