"use client";

import { useState, useEffect, useCallback } from "react";
import { t, type Locale } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { revokeScribeConsent } from "@/lib/scribe/actions";

interface RecordingControlsProps {
  consentId: string;
  language: "en-NG" | "pcm";
  onStop: (elapsedMs: number) => void;
  onRevoked: () => void;
}

function toLocale(lang: "en-NG" | "pcm"): Locale {
  return lang === "pcm" ? "pcm" : "en";
}

function formatElapsed(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const mins = String(Math.floor(totalSecs / 60)).padStart(2, "0");
  const secs = String(totalSecs % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}

export function RecordingControls({
  consentId,
  language,
  onStop,
  onRevoked,
}: RecordingControlsProps) {
  const locale = toLocale(language);
  const [paused, setPaused] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [revoking, setRevoking] = useState(false);

  useEffect(() => {
    if (paused) return;
    const interval = setInterval(() => {
      setElapsedMs((prev) => prev + 1000);
    }, 1000);
    return () => clearInterval(interval);
  }, [paused]);

  const handleRevoke = useCallback(async () => {
    setRevoking(true);
    try {
      await revokeScribeConsent(consentId);
      onRevoked();
    } catch {
      setRevoking(false);
    }
  }, [consentId, onRevoked]);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-tarragon-green/20 bg-tarragon-green/5 px-4 py-3">
      <Badge variant="outline" className="border-red-500 text-red-600">
        {paused ? t("scribe.recording.paused", locale) : t("scribe.recording.status", locale)}
      </Badge>

      <span className="font-mono text-sm tabular-nums">
        {formatElapsed(elapsedMs)}
      </span>

      <div className="ml-auto flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? t("scribe.recording.resume", locale) : t("scribe.recording.pause", locale)}
        </Button>
        <Button
          size="sm"
          onClick={() => onStop(elapsedMs)}
        >
          {t("scribe.recording.stop", locale)}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-red-600"
          onClick={handleRevoke}
          disabled={revoking}
        >
          {t("scribe.consent.revoked_label", locale)}
        </Button>
      </div>
    </div>
  );
}
