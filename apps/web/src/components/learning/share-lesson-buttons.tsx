"use client";

import { useState } from "react";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";

/** Link or email share. The link is the public article address only: it carries no account, patient or reading information. */
export function ShareLessonButtons({ title, url }: { title: string; url: string }) {
  const [copied, setCopied] = useState(false);
  // Neither the share sheet nor the clipboard worked: show the address so the person can copy it by hand, never a silent no-op.
  const [manual, setManual] = useState(false);
  const mailto = `mailto:?subject=${encodeURIComponent(t("learn.share.email_subject"))}&body=${encodeURIComponent(t("learn.share.email_body", "en", { title, url }))}`;

  async function share() {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // cancelled: fall through to copy
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setManual(true);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onClick={share}>
        {copied ? t("learn.share.copied") : t("learn.share.button")}
      </Button>
      {manual && (
        <input
          readOnly
          value={url}
          aria-label={t("learn.share.button")}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-md border border-charcoal-ink/20 px-2 py-1 text-xs"
        />
      )}
      <a href={mailto} className="text-sm font-medium text-brand-green underline dark:text-brand-green-bright">
        {t("learn.share.email")}
      </a>
    </div>
  );
}
