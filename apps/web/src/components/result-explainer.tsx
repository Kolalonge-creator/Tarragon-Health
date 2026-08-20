"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SEMANTIC_ICON } from "@/lib/icons";
import { explainPatientResultAction } from "@/lib/patient-explainer/actions";
import type { ExplainerKind } from "@/lib/patient-explainer/snapshot";

/**
 * "Help me understand this" -- the patient-facing sibling of CaseBriefCard.
 * Same "AI-drafted, never a diagnosis" badge discipline, extended to the
 * patient side per the founder's explicit ask (2026-07-31): AI as
 * infinite, patient-facing staff, not just doctor-facing.
 *
 * Collapsed by default (a button, not a card that's always open) -- this
 * sits attached to an existing card (RiskSignalsCard, LipidProfileCard),
 * so it must never compete with that card's own primary content until the
 * patient actually asks.
 *
 * ENGLISH ONLY (founder decision, 2026-08-03). The read-aloud control and the
 * language switcher that used to live here are gone: the browser Web Speech
 * API barely covers Yoruba/Hausa/Igbo, has no Nigerian Pidgin voice at all,
 * and shipping a half-working version of either was worse than shipping
 * neither. The DB still carries `profiles.language` and a `language` column on
 * the explanation cache, so this is re-openable the day a real TTS vendor and
 * actual demand both exist -- see the CLAUDE.md entry for the numbers behind
 * that call.
 */
export function ResultExplainer({
  kind,
  subjectKey,
  label,
  defaultOpen = false,
}: {
  kind: ExplainerKind;
  subjectKey: string;
  label: string;
  /** Skip the "help me understand this" ask and show the explanation right
   * away. For a result worth understanding without waiting to be asked
   * (e.g. a high/very_high risk signal) — still the same non-diagnostic,
   * AI-drafted card, just not gated behind a click. Leave false everywhere
   * else; most results should stay collapsed until the patient asks. */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [isPending, setIsPending] = useState(false);
  const [result, setResult] = useState<{
    status: "generated" | "failed";
    explanation: string | null;
  } | null>(null);

  async function load() {
    setIsPending(true);
    try {
      setResult(await explainPatientResultAction(kind, subjectKey, label));
    } finally {
      setIsPending(false);
    }
  }

  useEffect(() => {
    if (!defaultOpen) return;
    // Deferred a tick so load()'s setIsPending(true) isn't a same-frame
    // setState-in-effect (react-hooks/set-state-in-effect) -- functionally
    // still "on mount" for the patient, load() is still shared with the
    // click handler below.
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
    // Only ever auto-loads once, on mount, for the subject this instance was
    // given -- not meant to re-fire on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!open) {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="h-auto gap-1.5 px-0 text-xs text-brand-green hover:bg-transparent hover:underline"
        onClick={() => {
          setOpen(true);
          if (!result) void load();
        }}
      >
        <SEMANTIC_ICON.aiCoach className="h-3.5 w-3.5" aria-hidden />
        Help me understand this
      </Button>
    );
  }

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
        <p className="text-sm text-charcoal-ink">{result.explanation}</p>
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
