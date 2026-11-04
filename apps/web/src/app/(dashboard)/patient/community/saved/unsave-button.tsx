"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Locale, type MessageKey } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { setSaved } from "../community-actions";
import { TOUCH } from "../styles";

/** Removes one post from the member's saved list, then reloads the list. */
export function UnsaveButton({ postId, locale }: { postId: string; locale: Locale }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<MessageKey | null>(null);

  async function unsave() {
    setBusy(true);
    setNote(null);
    const result = await setSaved({ postId, saved: false }).catch(() => null);
    setBusy(false);
    if (result && result.ok) router.refresh();
    else setNote(result ? result.key : "community.compose.refused.other");
  }

  return (
    <>
      <Button type="button" variant="ghost" className={TOUCH} onClick={unsave} disabled={busy}>
        {t("community.saved.remove", locale)}
      </Button>
      <span role="status" aria-live="polite" className="text-sm">
        {note ? t(note, locale) : ""}
      </span>
    </>
  );
}
