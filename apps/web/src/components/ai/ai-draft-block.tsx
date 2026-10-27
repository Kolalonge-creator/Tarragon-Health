"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AiLabel } from "./ai-label";
import {
  acceptSpan,
  allReviewed,
  assembleText,
  attestationHolds,
  canSign,
  editSpan,
  editTelemetryFromSpans,
  liveSpans,
  spansFingerprint,
  splitIntoSpans,
  unreviewedCount,
  type AiSpan,
  type EditTelemetry,
} from "@/lib/ai-text/ai-spans";

export interface AiDraftSignResult {
  /** The text as it stands after review, with removed spans left out and line breaks kept. */
  text: string;
  telemetry: EditTelemetry;
  /** Always true when this fires: the clinician ticked "I reviewed this draft against the record" for these exact sentences. */
  attested: true;
}

interface AiDraftBlockProps {
  /** The model's text, exactly as produced. */
  initialText: string;
  /**
   * Present: the block shows the attestation checkbox and a Sign button (disabled while any span is unreviewed, nothing is left to sign,
   * or the box is unticked for the sentences as they now stand).
   * Absent: a read-only review block (spans can still be accepted or edited, nothing can be signed from here).
   * Signing records nothing by itself: the caller writes through the existing null-gated mechanism, so reviewed_by/reviewed_at come
   * from the server, never from this component.
   */
  onSign?: (result: AiDraftSignResult) => void;
  signLabel?: string;
  /** Called whenever the spans change, so a caller can hold the edit-rate figures. Computed in the browser only. */
  onTelemetry?: (telemetry: EditTelemetry) => void;
}

/** Each state is a visible word as well as a colour, so it never depends on colour to be understood. */
const SPAN_STATE: Record<Exclude<AiSpan["status"], "removed">, { word: string; style: string }> = {
  unreviewed: { word: "Not reviewed", style: "rounded bg-amber-100 px-0.5 ring-1 ring-amber-300" },
  accepted: { word: "Accepted", style: "rounded px-0.5" },
  edited: { word: "Edited", style: "rounded bg-sky-50 px-0.5" },
};

/**
 * AI-inserted text, marked sentence by sentence until the clinician accepts or edits each one. Nothing here writes to the patient record.
 * The sentence text sits apart from its controls and state word (which are not selectable), so copying the draft copies only the text.
 */
export function AiDraftBlock({ initialText, onSign, signLabel = "Sign", onTelemetry }: AiDraftBlockProps) {
  const [spans, setSpans] = useState<AiSpan[]>(() => splitIntoSpans(initialText));
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  // The attestation is bound to the sentences it was given for: any later change to any sentence makes it lapse (no reset call to forget).
  const [attestedFor, setAttestedFor] = useState<string | null>(null);

  function update(next: AiSpan[]) {
    setSpans(next);
    onTelemetry?.(editTelemetryFromSpans(next));
  }

  const attested = attestationHolds(attestedFor, spans);
  const remaining = unreviewedCount(spans);
  const nothingLeft = liveSpans(spans).length === 0;

  return (
    <div className="space-y-2" data-testid="ai-draft-block">
      <AiLabel reviewed={allReviewed(spans) && !nothingLeft} />
      <div className="whitespace-pre-wrap text-sm text-charcoal-ink">
        {spans.map((s) => {
          if (s.status === "removed") return null;
          const n = s.id + 1;
          const state = SPAN_STATE[s.status];
          return (
            <span key={s.id}>
              {s.sep}
              <span data-span-status={s.status} className={`${state.style} inline-block`}>
                {editing === s.id ? (
                  <span className="inline-flex items-center gap-1">
                    <input
                      aria-label={`Edit sentence ${n}`}
                      className="min-w-[16rem] rounded border border-charcoal-ink/20 px-1 text-sm"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Save sentence ${n}`}
                      onClick={() => {
                        update(editSpan(spans, s.id, draft));
                        setEditing(null);
                      }}
                    >
                      Save
                    </Button>
                  </span>
                ) : (
                  <>
                    <span data-ai-text>{s.text}</span>
                    <span className="ml-1 inline-flex select-none gap-1 align-middle" data-ai-controls>
                      <span className="text-xs text-charcoal-ink/70" data-span-state>{state.word}</span>
                      {s.status === "unreviewed" && (
                        <button type="button" className="text-xs underline" aria-label={`Accept sentence ${n}`} onClick={() => update(acceptSpan(spans, s.id))}>
                          Accept
                        </button>
                      )}
                      <button
                        type="button"
                        className="text-xs underline"
                        aria-label={`Edit sentence ${n}`}
                        onClick={() => {
                          setEditing(s.id);
                          setDraft(s.text);
                        }}
                      >
                        Edit
                      </button>
                    </span>
                  </>
                )}
              </span>
            </span>
          );
        })}
      </div>
      <p role="status" className="text-xs text-charcoal-ink/70">
        {nothingLeft
          ? "No sentences are left: there is nothing to sign."
          : remaining === 0
            ? "Every sentence has been reviewed."
            : `${remaining} sentence${remaining === 1 ? "" : "s"} still to review. Accept or edit each one.`}
      </p>
      {onSign && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-charcoal-ink">
            <input type="checkbox" checked={attested} onChange={(e) => setAttestedFor(e.target.checked ? spansFingerprint(spans) : null)} />
            I reviewed this draft against the record
          </label>
          <Button
            size="sm"
            disabled={!canSign(spans, attested)}
            onClick={() => onSign({ text: assembleText(spans), telemetry: editTelemetryFromSpans(spans), attested: true })}
          >
            {signLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
