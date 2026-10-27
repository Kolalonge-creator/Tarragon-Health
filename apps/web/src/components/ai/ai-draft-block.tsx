"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AiLabel } from "./ai-label";
import {
  acceptSpan,
  allReviewed,
  assembleText,
  canSign,
  editSpan,
  editTelemetryFromSpans,
  splitIntoSpans,
  unreviewedCount,
  type AiSpan,
  type EditTelemetry,
} from "@/lib/ai-text/ai-spans";

export interface AiDraftSignResult {
  /** The text as it stands after review, with removed spans left out. */
  text: string;
  telemetry: EditTelemetry;
  /** Always true when this fires: the clinician ticked "I reviewed this draft against the record". */
  attested: true;
}

interface AiDraftBlockProps {
  /** The model's text, exactly as produced. */
  initialText: string;
  /**
   * Present: the block shows the attestation checkbox and a Sign button (disabled while any span is unreviewed or the box is unticked).
   * Absent: a read-only review block (spans can still be accepted or edited, nothing can be signed from here).
   * Signing records nothing by itself: the caller writes through the existing null-gated mechanism, so reviewed_by/reviewed_at come
   * from the server, never from this component.
   */
  onSign?: (result: AiDraftSignResult) => void;
  signLabel?: string;
  /** Called whenever the spans change, so a caller can hold the edit-rate figures. Computed in the browser only. */
  onTelemetry?: (telemetry: EditTelemetry) => void;
}

const SPAN_STYLE: Record<AiSpan["status"], string> = {
  unreviewed: "rounded bg-amber-100 px-0.5 ring-1 ring-amber-300",
  accepted: "rounded px-0.5",
  edited: "rounded bg-sky-50 px-0.5",
  removed: "hidden",
};

/**
 * AI-inserted text, marked span by span until the clinician accepts or edits each one. Nothing here writes to the patient record.
 */
export function AiDraftBlock({ initialText, onSign, signLabel = "Sign", onTelemetry }: AiDraftBlockProps) {
  const [spans, setSpans] = useState<AiSpan[]>(() => splitIntoSpans(initialText));
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [attested, setAttested] = useState(false);

  function update(next: AiSpan[]) {
    setSpans(next);
    onTelemetry?.(editTelemetryFromSpans(next));
  }

  const remaining = unreviewedCount(spans);

  return (
    <div className="space-y-2" data-testid="ai-draft-block">
      <AiLabel reviewed={allReviewed(spans) && spans.length > 0} />
      <p className="text-sm text-charcoal-ink">
        {spans.map((s) => (
          <span key={s.id} data-span-status={s.status} className={`${SPAN_STYLE[s.status]} mr-1 inline-block`}>
            {editing === s.id ? (
              <span className="inline-flex items-center gap-1">
                <input
                  aria-label="Edit this sentence"
                  className="min-w-[16rem] rounded border border-charcoal-ink/20 px-1 text-sm"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    update(editSpan(spans, s.id, draft));
                    setEditing(null);
                    setAttested(false);
                  }}
                >
                  Save
                </Button>
              </span>
            ) : (
              <>
                {s.text}
                {s.status !== "removed" && (
                  <span className="ml-1 inline-flex gap-1 align-middle">
                    {s.status === "unreviewed" && (
                      <button type="button" className="text-xs underline" onClick={() => update(acceptSpan(spans, s.id))}>
                        Accept
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-xs underline"
                      onClick={() => {
                        setEditing(s.id);
                        setDraft(s.text);
                      }}
                    >
                      Edit
                    </button>
                  </span>
                )}
              </>
            )}
          </span>
        ))}
      </p>
      <p role="status" className="text-xs text-charcoal-ink/70">
        {remaining === 0 ? "Every sentence has been reviewed." : `${remaining} sentence${remaining === 1 ? "" : "s"} still to review. Accept or edit each one.`}
      </p>
      {onSign && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-charcoal-ink">
            <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
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
