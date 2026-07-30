"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useOverrideAlertLevel, useClearAlertOverride } from "@/lib/queries/clinician-alerts";
import { LEVEL_BADGE } from "@/lib/worklist/level-badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { EscalationLevel } from "@tarragon/shared";

const LEVEL_OPTIONS: EscalationLevel[] = ["routine", "clinician_review", "urgent_escalation", "emergency"];

/**
 * Lets a clinician record disagreement with the system's own deterministic
 * classification (clinician_alerts.level) — v3 port, "deterministic
 * always-classify with a clinician_override field". The system's level is
 * never touched; this writes a separate override_level/override_reason
 * pair. overridden_by/overridden_at are always server-derived (see
 * private.enforce_alert_override_clinical_only) — a Care Coordinator or
 * other non-clinical session gets that trigger's real rejection message,
 * surfaced as-is rather than a generic fallback.
 */
export function AlertOverrideControl({
  alertId,
  overrideLevel,
  overrideReason,
  overriddenAt,
  overriddenByName,
}: {
  alertId: string;
  overrideLevel: EscalationLevel | null;
  overrideReason: string | null;
  overriddenAt: string | null;
  overriddenByName: string | null;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [level, setLevel] = useState<EscalationLevel>("clinician_review");
  const [reason, setReason] = useState("");
  const override = useOverrideAlertLevel();
  const clear = useClearAlertOverride();

  if (overrideLevel) {
    const badge = LEVEL_BADGE[overrideLevel];
    return (
      <div className="rounded-md border border-charcoal-ink/10 bg-charcoal-ink/[0.02] p-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-charcoal-ink/60">Overridden to</span>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
        {overrideReason && <p className="mt-1 text-charcoal-ink/80">&ldquo;{overrideReason}&rdquo;</p>}
        {overriddenByName && overriddenAt && (
          <p className="mt-1 text-xs text-charcoal-ink/50">
            By {overriddenByName} on {new Date(overriddenAt).toLocaleDateString()}
          </p>
        )}
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          disabled={clear.isPending}
          onClick={() => clear.mutate(alertId, { onSuccess: () => router.refresh() })}
        >
          {clear.isPending ? "Clearing…" : "Clear override"}
        </Button>
        {clear.isError && (
          <p className="mt-1 text-xs text-red-600">{clear.error?.message || "Could not clear the override."}</p>
        )}
      </div>
    );
  }

  if (!isOpen) {
    return (
      <Button size="sm" variant="outline" onClick={() => setIsOpen(true)}>
        Override classification
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-charcoal-ink/10 p-3">
      <p className="text-xs text-charcoal-ink/60">
        Disagree with the auto-assigned level? Record your own: the system&apos;s original
        classification is kept, never overwritten.
      </p>
      <Select value={level} onChange={(e) => setLevel(e.target.value as EscalationLevel)}>
        {LEVEL_OPTIONS.map((l) => (
          <option key={l} value={l}>
            {LEVEL_BADGE[l].label}
          </option>
        ))}
      </Select>
      <Input
        placeholder="Reason for the override"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {override.isError && (
        <p className="text-xs text-red-600">{override.error?.message || "Could not save the override."}</p>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={override.isPending || reason.trim().length === 0}
          onClick={() =>
            override.mutate(
              { alertId, overrideLevel: level, overrideReason: reason.trim() },
              {
                onSuccess: () => {
                  setIsOpen(false);
                  router.refresh();
                },
              }
            )
          }
        >
          {override.isPending ? "Saving…" : "Save override"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setIsOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
