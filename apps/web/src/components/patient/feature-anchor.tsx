"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Wraps one card so a feature can be linked to directly, and so arriving via
 * that link visibly lands the reader ON the card.
 *
 * The registry (lib/patient/feature-registry.ts) promises that every `href`
 * with a `#fragment` resolves to a real element. This is the component that
 * keeps that promise, and it does two things a bare `id` attribute does not:
 *
 *  - clears the sticky topbar (`scroll-mt-36`), so a hash link doesn't park
 *    the card underneath the header;
 *  - flashes a brand ring for a moment on arrival. Without it, following
 *    "Cycle and reproductive health" from search dumps you into the middle of
 *    a long page with no signal about which of the six cards in view was the
 *    one you asked for. The ring answers that, then gets out of the way.
 *
 * The flash is opt-out for reduced-motion (it is a colour fade, not motion,
 * but it is decoration either way) and never traps focus or moves it — this
 * is a landmark, not a dialog.
 */
export function FeatureAnchor({
  id,
  children,
  className,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [flashing, setFlashing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let flashTimer: number | undefined;
    let retry: number | undefined;

    function arrive() {
      if (window.location.hash.replace("#", "") !== id) return;

      // A card can sit inside a container that is not laid out yet — the
      // Prevention hub keeps every tab panel mounted but `hidden`, and
      // PreventionTabs only reveals the owning one after it has resolved the
      // hash. Scrolling to an element with no layout is a silent no-op, which
      // is what left a deep link landing near the card rather than on it. So
      // wait for the element to actually have a box before scrolling, with a
      // short bound so this can never spin on a card that stays hidden.
      const deadline = Date.now() + 2000;
      const tryScroll = () => {
        const el = ref.current;
        if (!el) return;
        // offsetParent is null while any ancestor is display:none, which is
        // exactly the hidden-tab-panel case. Poll rather than count frames:
        // the reveal waits on another component's effect and a React commit,
        // and a frame budget expires long before a slow one of those does.
        if (el.offsetParent === null) {
          if (Date.now() < deadline) {
            retry = window.setTimeout(tryScroll, 50);
          }
          return;
        }
        el.scrollIntoView({ block: "start" });
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        setFlashing(true);
        flashTimer = window.setTimeout(() => setFlashing(false), 2200);
      };
      tryScroll();
    }

    arrive();
    window.addEventListener("hashchange", arrive);
    return () => {
      if (flashTimer !== undefined) window.clearTimeout(flashTimer);
      if (retry !== undefined) window.clearTimeout(retry);
      window.removeEventListener("hashchange", arrive);
    };
  }, [id]);

  return (
    <div
      ref={ref}
      id={id}
      className={cn(
        "scroll-mt-36 rounded-xl transition-shadow duration-500",
        flashing && "ring-2 ring-brand-green ring-offset-4",
        className,
      )}
    >
      {children}
    </div>
  );
}
