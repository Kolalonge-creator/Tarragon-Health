"use client";

import { useEffect } from "react";

/**
 * Removes the one-shot notice id (?n=) from the address once the notice is on screen, so a reload or a copied link shows no stale
 * banner. The notice itself only ever shows when the id matches the cookie the action set (lib/go-live/flash.ts).
 */
export function FlashClean() {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("n")) {
      url.searchParams.delete("n");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }
  }, []);
  return null;
}
