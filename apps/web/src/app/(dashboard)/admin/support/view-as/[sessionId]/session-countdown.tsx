"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";

/** Client-side countdown to expires_at — purely cosmetic. The real time-box is
 * enforced server-side (private.can_support_view checks expires_at > now()), so a
 * paused tab or a clock skew here can never extend the actual read grant. */
export function SessionCountdown({ expiresAt }: { expiresAt: string }) {
  const router = useRouter();
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000))
  );

  useEffect(() => {
    const id = setInterval(() => {
      const remaining = Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) {
        // Stop ticking once expired — otherwise this fires router.refresh() every
        // second thereafter until the server round-trip flips isActive to false and
        // unmounts this component, which can queue up several redundant refreshes
        // of the page's 7-query Promise.all if that round-trip is slow.
        clearInterval(id);
        router.refresh();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt, router]);

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

  return (
    <Badge variant={secondsLeft < 300 ? "amber" : "green"}>
      {secondsLeft === 0 ? "Expiring…" : `${minutes}:${seconds.toString().padStart(2, "0")} left`}
    </Badge>
  );
}
