import { useCallback, useEffect, useState } from "react";
import { RESEND_COOLDOWN_SECONDS, secondsUntilResend } from "./auth-flow";

/** Visible resend countdown. `restart()` begins a fresh cooldown (a code was just sent). */
export function useResendCountdown(): { seconds: number; restart: () => void } {
  const [availableAt, setAvailableAt] = useState(() => Date.now() + RESEND_COOLDOWN_SECONDS * 1000);
  const [seconds, setSeconds] = useState(RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    const tick = () => setSeconds(secondsUntilResend(Date.now(), availableAt));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [availableAt]);

  const restart = useCallback(() => setAvailableAt(Date.now() + RESEND_COOLDOWN_SECONDS * 1000), []);
  return { seconds, restart };
}
