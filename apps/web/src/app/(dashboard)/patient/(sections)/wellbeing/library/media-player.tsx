"use client";

import { useRef, useState } from "react";
import { t } from "@tarragon/i18n";
import { recordMediaSessionAction } from "./actions";

/**
 * Audio session (meditation, sleep story, soundscape). Plays only from the reviewed file. A sleep timer pauses playback so a phone is not
 * left playing all night. Recording the session is best effort and carries no content to anyone but the patient.
 */
export function MediaPlayer({ mediaId, src, sleepTimer }: { mediaId: string; src: string; sleepTimer: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const timer = useRef<number | null>(null);
  const [stopAfter, setStopAfter] = useState(0);
  const [done, setDone] = useState(false);

  const arm = (minutes: number) => {
    setStopAfter(minutes);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    if (minutes > 0) timer.current = window.setTimeout(() => audio.current?.pause(), minutes * 60_000);
  };
  const finish = () => {
    const secs = audio.current?.currentTime ?? 0;
    setDone(true);
    void recordMediaSessionAction(mediaId, secs);
  };
  return (
    <div className="space-y-3">
      <audio ref={audio} controls preload="none" src={src} onEnded={finish} className="w-full" />
      {sleepTimer && (
        <div className="grid gap-1">
          <label htmlFor="sleep-stop" className="text-sm">{t("library.player.sleep_timer")}</label>
          <select id="sleep-stop" value={stopAfter} onChange={(e) => arm(Number(e.target.value))} className="w-32 rounded-md border border-charcoal-ink/20 dark:border-night-ink/25 bg-transparent px-2 py-1.5 text-sm">
            <option value={0}>-</option>
            {[10, 20, 30, 45, 60].map((m) => (<option key={m} value={m}>{m} min</option>))}
          </select>
        </div>
      )}
      {done && <p role="status" className="text-sm">{t("library.player.done")}</p>}
    </div>
  );
}
