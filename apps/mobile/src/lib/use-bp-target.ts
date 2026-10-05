import { useEffect, useState } from "react";
import { loadBpTarget } from "./bp-target";
import type { PersonalBpTarget } from "./bp-trend-rules";
import { supabase } from "./supabase";

/**
 * The care team's blood pressure target for this patient, or null until it has
 * loaded (and when none is set). Never throws and never blocks the screen: until
 * the answer arrives the card simply shows no target and no per-day statuses.
 */
export function useBpTarget(patientId: string): PersonalBpTarget | null {
  const [target, setTarget] = useState<PersonalBpTarget | null>(null);
  useEffect(() => {
    let alive = true;
    setTarget(null);
    void (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (!userId) return;
        const res = await loadBpTarget(userId, patientId);
        if (alive) setTarget(res.target);
      } catch {
        // no target shown
      }
    })();
    return () => {
      alive = false;
    };
  }, [patientId]);
  return target;
}
