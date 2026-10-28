"use client";

import { useEffect } from "react";

/**
 * Opens the sign-off line a link points at. A hub line is a <details> element, which the browser scrolls to but leaves
 * closed, so a link from the S06 to S10 banner would land on a collapsed row. This opens it on load and when the hash changes.
 */
export function OpenOnHash() {
  useEffect(() => {
    const open = () => {
      const id = window.location.hash.slice(1);
      if (!id) return;
      const el = document.getElementById(id);
      if (!el) return;
      // Also open every enclosing <details> (the "Signed and running" dropdown wraps its lines), or the target stays hidden.
      for (let p = el.parentElement?.closest("details"); p; p = p.parentElement?.closest("details")) p.open = true;
      if (el instanceof HTMLDetailsElement) {
        el.open = true;
        el.scrollIntoView({ block: "start" });
      }
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  return null;
}
