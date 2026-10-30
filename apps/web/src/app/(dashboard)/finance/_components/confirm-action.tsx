"use client";

import { useState, type ReactNode } from "react";
import { ConfirmDialog, ConfirmDialogFacts } from "@/components/ui/confirm-dialog";

/**
 * One confirmation for a finance action that removes, undoes or dismisses a
 * record. Each of these used to run on a single click: the Remove link on a
 * budget line or an employer's billing rate, Undo on a filed statutory
 * obligation, Ignore on a fraud signal or a reconciliation flag. The records
 * are shown back in the dialog so the person confirms the thing they meant, and
 * the action runs only on Confirm. Cancel, Escape and a click outside do nothing.
 */
export interface ConfirmSpec {
  title: string;
  description?: string;
  /** The record being acted on, shown back as label/value rows. */
  facts?: { label: string; value: ReactNode }[];
  confirmLabel: string;
  /** Red confirm button. Default true: these are removals. */
  destructive?: boolean;
  run: () => Promise<unknown> | void;
}

export function useConfirmAction() {
  const [spec, setSpec] = useState<ConfirmSpec | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!spec || busy) return;
    setBusy(true);
    try {
      await spec.run();
    } finally {
      setBusy(false);
      setSpec(null);
    }
  }

  const dialog = (
    <ConfirmDialog
      open={spec !== null}
      title={spec?.title ?? ""}
      description={spec?.description}
      confirmLabel={busy ? "Working…" : (spec?.confirmLabel ?? "Confirm")}
      confirmDisabled={busy}
      destructive={spec?.destructive ?? true}
      onCancel={() => {
        if (!busy) setSpec(null);
      }}
      onConfirm={confirm}
    >
      {spec?.facts && spec.facts.length > 0 && <ConfirmDialogFacts rows={spec.facts} />}
    </ConfirmDialog>
  );

  return { ask: setSpec, dialog };
}
