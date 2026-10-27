"use client";

import { useState } from "react";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";

/**
 * S59c: the "save this card" view. A plain text copy of the result and the safety net that can be copied, screenshotted or read out, for
 * a slow connection or a low-bandwidth phone. SHARED-PHONE SAFE: the card lives in component state only. This component never writes
 * to local storage, session storage, cookies, a URL or the network, and "Clear this screen" removes it (and, if the person copied it
 * here, overwrites the clipboard with nothing) and hands control back to the parent, which also forgets the result.
 */
export function SaveCardPanel({ text, onClear }: { text: string; onClear: () => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false); // the text is on the screen to copy or screenshot by hand
    }
  }

  async function clear() {
    if (copied) {
      try {
        await navigator.clipboard.writeText("");
      } catch {
        // a blocked clipboard cannot be cleared by us; the card itself is gone either way
      }
    }
    setCopied(false);
    setOpen(false);
    onClear();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {t("symptom.card.open")}
        </Button>
        <Button type="button" variant="outline" onClick={clear}>
          {t("symptom.card.clear")}
        </Button>
      </div>
      {open && (
        <div className="space-y-2 rounded-lg border border-charcoal-ink/10 p-3 dark:border-night-ink/15" data-testid="save-card">
          <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{t("symptom.card.hint")}</p>
          <pre className="whitespace-pre-wrap break-words rounded bg-charcoal-ink/5 p-3 font-sans text-sm text-charcoal-ink dark:bg-night-ink/10 dark:text-night-ink">{text}</pre>
          <Button type="button" variant="outline" onClick={copy}>
            {copied ? t("symptom.card.copied") : t("symptom.card.copy")}
          </Button>
          <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{t("symptom.card.shared_phone")}</p>
        </div>
      )}
    </div>
  );
}
