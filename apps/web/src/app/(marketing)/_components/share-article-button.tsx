"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Uses the native share sheet where available (the common case on mobile,
 * where it naturally surfaces WhatsApp — the channel most Nigerian readers
 * would actually share a health article through). Falls back to a
 * clipboard-copy with inline confirmation on desktop / unsupported browsers.
 * No article content leaves the device beyond the title/url a user already
 * chose to share.
 */
export function ShareArticleButton({
  title,
  url,
  className,
}: {
  title: string;
  url: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // Cancelled or unsupported mid-call; fall through to clipboard copy.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable; nothing more to do without a page reload.
    }
  };

  return (
    <button
      type="button"
      onClick={handleShare}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-charcoal-ink/15 bg-white px-3.5 py-1.5 text-xs font-semibold text-charcoal-ink shadow-sm transition hover:border-brand-green/40 hover:text-brand-green focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-green",
        className
      )}
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" aria-hidden>
        <circle cx="18" cy="5.5" r="2.4" stroke="currentColor" strokeWidth="1.75" />
        <circle cx="6" cy="12" r="2.4" stroke="currentColor" strokeWidth="1.75" />
        <circle cx="18" cy="18.5" r="2.4" stroke="currentColor" strokeWidth="1.75" />
        <path
          d="M8.1 10.6l7.7-3.9M8.1 13.4l7.7 3.9"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
      </svg>
      {copied ? "Link copied" : "Share"}
    </button>
  );
}
