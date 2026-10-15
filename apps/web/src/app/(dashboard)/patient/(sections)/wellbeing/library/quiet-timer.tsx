"use client";

import { useEffect, useRef, useState } from "react";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** A plain quiet timer (10.4): no sound, no score, no streak. */
export function QuietTimer() {
  const [minutes, setMinutes] = useState(5);
  const [left, setLeft] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const endsAt = useRef(0);

  useEffect(() => {
    if (left === null) return;
    const id = window.setInterval(() => {
      const remaining = Math.ceil((endsAt.current - Date.now()) / 1000);
      if (remaining <= 0) {
        setLeft(null);
        setDone(true);
      } else setLeft(remaining);
    }, 500);
    return () => window.clearInterval(id);
  }, [left]);

  const start = () => {
    endsAt.current = Date.now() + minutes * 60_000;
    setDone(false);
    setLeft(minutes * 60);
  };
  const mm = left === null ? 0 : Math.floor(left / 60);
  const ss = left === null ? 0 : left % 60;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("library.timer.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {left === null ? (
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1">
              <label htmlFor="quiet-minutes" className="text-sm">{t("library.timer.minutes")}</label>
              <select id="quiet-minutes" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="w-24 rounded-md border border-charcoal-ink/20 dark:border-night-ink/25 bg-transparent px-2 py-1.5 text-sm">
                {[3, 5, 10, 15, 20].map((m) => (<option key={m} value={m}>{m}</option>))}
              </select>
            </div>
            <Button type="button" onClick={start}>{t("library.timer.start")}</Button>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <p className="text-2xl tabular-nums" role="timer" aria-label={`${mm}:${String(ss).padStart(2, "0")}`}>{mm}:{String(ss).padStart(2, "0")}</p>
            <Button type="button" variant="outline" onClick={() => setLeft(null)}>{t("library.timer.stop")}</Button>
          </div>
        )}
        {done && <p role="status" className="text-sm">{t("library.timer.done")}</p>}
      </CardContent>
    </Card>
  );
}
