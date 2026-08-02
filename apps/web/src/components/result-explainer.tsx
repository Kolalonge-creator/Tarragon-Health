"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SEMANTIC_ICON } from "@/lib/icons";
import { explainPatientResultAction } from "@/lib/patient-explainer/actions";
import type { ExplainerKind } from "@/lib/patient-explainer/snapshot";

/** BCP-47 tags to try for each profiles.language code, in preference order --
 * a browser's installed voice list varies by OS/browser, so this tries the
 * Nigeria-specific tag first and falls back to the bare language. Pidgin has
 * no standard speech-synthesis voice anywhere; it deliberately has no entry,
 * so the read-aloud control simply won't render for it. */
const SPEECH_LANG_CANDIDATES: Record<string, string[]> = {
  en: ["en-NG", "en-GB", "en-US", "en"],
  yo: ["yo-NG", "yo"],
  ha: ["ha-NG", "ha"],
  ig: ["ig-NG", "ig"],
};

function findSpeechVoice(language: string): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const candidates = SPEECH_LANG_CANDIDATES[language];
  if (!candidates) return null;
  const voices = window.speechSynthesis.getVoices();
  for (const tag of candidates) {
    const exact = voices.find((v) => v.lang.toLowerCase() === tag.toLowerCase());
    if (exact) return exact;
  }
  // Loose prefix match as a last resort (e.g. any "en-*" voice for "en").
  const prefix = candidates[candidates.length - 1];
  return voices.find((v) => v.lang.toLowerCase().startsWith(prefix.toLowerCase())) ?? null;
}

/**
 * "Help me understand this" -- the patient-facing sibling of CaseBriefCard.
 * Same "AI-drafted, never a diagnosis" badge discipline, extended to the
 * patient side per the founder's explicit ask (2026-07-31): AI as
 * infinite, patient-facing staff, not just doctor-facing.
 *
 * Collapsed by default (a button, not a card that's always open) -- this
 * sits attached to an existing card (RiskSignalsCard, LipidProfileCard),
 * so it must never compete with that card's own primary content until the
 * patient actually asks. Read-aloud uses the browser's own Web Speech API
 * (zero vendor dependency, zero marginal cost) -- gracefully hidden when no
 * matching voice is installed, which varies a lot across Nigerian-language
 * coverage by OS/browser. Real production-quality multilingual TTS is a
 * genuine gap this doesn't close; flagged as a follow-up, not silently
 * pretended away.
 */
export function ResultExplainer({
  kind,
  subjectKey,
  label,
  language,
}: {
  kind: ExplainerKind;
  subjectKey: string;
  label: string;
  /** The patient's own profiles.language -- passed down rather than
   * re-fetched, since the parent card already has the profile loaded. */
  language: string;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [result, setResult] = useState<{ status: "generated" | "failed"; explanation: string | null } | null>(null);
  const [viewLanguage, setViewLanguage] = useState(language);
  const [isSpeaking, setIsSpeaking] = useState(false);
  // Lazy-initialized from a synchronous read, not set from inside the effect
  // below -- some browsers have the voice list ready immediately. This never
  // causes a hydration mismatch: the branch that reads voicesReady only
  // renders after the patient has clicked to open the panel, never during
  // the initial (server-rendered) paint.
  const [voicesReady, setVoicesReady] = useState(
    () => typeof window !== "undefined" && Boolean(window.speechSynthesis?.getVoices().length)
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    // Chrome loads the voice list asynchronously -- this only ever fires
    // later, in response to the browser's own event, never synchronously.
    const handler = () => setVoicesReady(true);
    window.speechSynthesis.addEventListener("voiceschanged", handler);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", handler);
  }, []);

  async function load(lang: string) {
    setIsPending(true);
    try {
      const res = await explainPatientResultAction(kind, subjectKey, label, lang);
      setResult(res);
      setViewLanguage(lang);
    } finally {
      setIsPending(false);
    }
  }

  function speak() {
    if (!result?.explanation || typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(result.explanation);
    const voice = findSpeechVoice(viewLanguage);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }

  if (!open) {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="h-auto gap-1.5 px-0 text-xs text-brand-green hover:bg-transparent hover:underline"
        onClick={() => {
          setOpen(true);
          if (!result) void load(language);
        }}
      >
        <SEMANTIC_ICON.aiCoach className="h-3.5 w-3.5" aria-hidden />
        Help me understand this
      </Button>
    );
  }

  const canSpeak = voicesReady && Boolean(findSpeechVoice(viewLanguage)) && Boolean(result?.explanation);
  const canViewEnglish = viewLanguage !== "en";

  return (
    <div className="mt-2 space-y-2 rounded-md border border-mist-grey/60 bg-mist-grey/20 p-3">
      <div className="flex items-center gap-2">
        <Badge variant="grey">AI-drafted — for understanding, not a diagnosis</Badge>
      </div>

      {isPending && <p className="text-sm text-charcoal-ink/60">Working this out for you…</p>}

      {!isPending && result?.status === "failed" && (
        <p className="text-sm text-charcoal-ink/60">
          Couldn&apos;t put together an explanation right now — nothing else on this page is
          affected. Your care team can walk you through this number any time.
        </p>
      )}

      {!isPending && result?.status === "generated" && result.explanation && (
        <>
          <p className="text-sm text-charcoal-ink">{result.explanation}</p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            {canSpeak && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-xs"
                onClick={speak}
                disabled={isSpeaking}
              >
                <SEMANTIC_ICON.speak className="h-3.5 w-3.5" aria-hidden />
                {isSpeaking ? "Reading aloud…" : "Read aloud"}
              </Button>
            )}
            {canViewEnglish && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-0 text-xs text-charcoal-ink/60 hover:bg-transparent hover:underline"
                disabled={isPending}
                onClick={() => void load("en")}
              >
                View in English
              </Button>
            )}
          </div>
        </>
      )}

      <button
        type="button"
        className="text-xs text-charcoal-ink/40 hover:underline"
        onClick={() => setOpen(false)}
      >
        Hide
      </button>
    </div>
  );
}
