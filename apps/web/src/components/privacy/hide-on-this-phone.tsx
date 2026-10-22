"use client";

import { useEffect, useState, type ReactNode } from "react";
import { isHiddenOnDevice, setHiddenOnDevice, type HideableCard, type LockStorage } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { browserLockStorage } from "@/components/private-section/use-private-lock";

/**
 * "Hide on this phone" (UI-B change 6): a quick switch on a sensitive card (cycle, pregnancy, contraception, growth) so a glance at a
 * shared screen does not show it. Stored on this device only, with the same storage the PrivateSection lock uses. It deletes nothing,
 * changes nobody else's access and is not a lock (showing the card again needs no PIN); a PIN is PrivateSection's job, and the note
 * under the button says so. A storage that cannot be read leaves the card visible, never hidden.
 *
 *   <HideOnThisPhone accountId={id} card="growth">...the card...</HideOnThisPhone>
 *
 * The placeholder is neutral on purpose: it does not say what is hidden.
 */
export function HideOnThisPhone({
  accountId,
  card,
  children,
  storage = browserLockStorage,
}: {
  accountId: string;
  card: HideableCard;
  children: ReactNode;
  storage?: LockStorage;
}) {
  const [hidden, setHidden] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void isHiddenOnDevice(storage, accountId, card).then((h) => {
      if (alive) setHidden(h);
    });
    return () => {
      alive = false;
    };
  }, [storage, accountId, card]);

  async function change(next: boolean) {
    const ok = await setHiddenOnDevice(storage, accountId, card, next);
    setFailed(!ok);
    if (ok) setHidden(next);
  }

  // Until the stored choice is read, show nothing from the card at all: a hidden card must never flash on a shared screen.
  if (hidden === null) return null;

  if (hidden) {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <p role="status" className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
            {t("uib.hide.hidden")}
          </p>
          <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={() => void change(false)}>
            {t("uib.hide.show")}
          </Button>
          {failed && (
            <p role="alert" className="basis-full text-sm text-red-700 dark:text-red-300">
              {t("common.try_again")}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span id={`hide-note-${card}`} className="sr-only">
          {t("uib.hide.note")}
        </span>
        <Button type="button" size="sm" variant="ghost" className="min-h-11" aria-describedby={`hide-note-${card}`} onClick={() => void change(true)}>
          {t("uib.hide.action")}
        </Button>
      </div>
      {failed && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {t("common.try_again")}
        </p>
      )}
      {children}
    </div>
  );
}
