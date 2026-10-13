"use client";

import { useState } from "react";
import { t, type Locale, type MessageKey } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { MUTED, TOUCH } from "./styles";
import { unhideAuthor } from "./community-actions";

export type HiddenAuthor = { id: string; handle: string };

/**
 * "People you have hidden" in this group: made-up names only, each with a plain "Show again" button. The note says they are never told.
 * Hiding is the member's own private choice; it changes nothing for anyone else.
 */
export function HiddenAuthors({ hidden, locale, onChanged }: { hidden: readonly HiddenAuthor[]; locale: Locale; onChanged: () => void }) {
  const [note, setNote] = useState<MessageKey | null>(null);

  async function show(id: string) {
    setNote(null);
    const result = await unhideAuthor({ id }).catch(() => null);
    if (result && result.ok) onChanged();
    else setNote(result ? result.key : "community.compose.refused.other");
  }

  return (
    <section aria-labelledby="community-hidden-title" className="space-y-2 rounded-xl border p-4">
      <h3 id="community-hidden-title" className="font-medium">
        {t("community.group.hidden_title", locale)}
      </h3>
      {hidden.length === 0 ? (
        <p className={`text-sm ${MUTED}`}>{t("community.group.hidden_none", locale)}</p>
      ) : (
        <ul className="space-y-1">
          {hidden.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{h.handle}</span>
              <Button type="button" variant="outline" className={TOUCH} aria-label={`${t("community.group.unhide", locale)}: ${h.handle}`} onClick={() => void show(h.id)}>
                {t("community.group.unhide", locale)}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className={`text-sm ${MUTED}`}>{t("community.group.hidden_note", locale)}</p>
      <p role="status" aria-live="polite" className="text-sm">
        {note ? t(note, locale) : ""}
      </p>
    </section>
  );
}
