"use client";

import { useEffect } from "react";

const STORAGE_KEY = "signoff-hub-lines";

/**
 * After a signing the page refreshes and used to leave the CMO at the top of the hub. This watches the ordered list of lines that still need a
 * signature: when one has disappeared since the last render (it was signed), it opens the line that came after it and scrolls there, so the
 * next thing to sign is on screen. The first render only records the list, so opening the page never jumps anywhere.
 *
 * Pure so it can be tested: given the previous and current ordered ids, the id to go to, or null.
 */
export function nextLineAfterSigning(previous: string[], current: string[]): string | null {
  const gone = previous.findIndex((id) => !current.includes(id));
  if (gone === -1 || current.length === 0) return null;
  const after = previous.slice(gone + 1).find((id) => current.includes(id));
  return after ?? current[0] ?? null;
}

export function AdvanceToNext({ lineIds }: { lineIds: string[] }) {
  const key = lineIds.join("|");
  useEffect(() => {
    let previous: string[] = [];
    try {
      previous = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "[]") as string[];
    } catch {
      previous = [];
    }
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(lineIds));
    } catch {
      /* private window: the list is simply not remembered, nothing breaks */
    }
    const target = nextLineAfterSigning(previous, lineIds);
    if (!target) return;
    // Let the refreshed list settle, then open the line and bring it into view.
    const timer = window.setTimeout(() => {
      const el = document.getElementById(target);
      if (el instanceof HTMLDetailsElement) el.open = true;
      el?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 150);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the stable form of lineIds
  }, [key]);
  return null;
}
