import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { ageYearsOn } from "./triage-device";

/**
 * The patient's age in whole years, or null until it has loaded or when no date of birth is on file. Never throws and never
 * blocks a screen: callers fall back to the under-80 default until an age is known.
 */
export function usePatientAge(patientId: string, nowMs: number): number | null {
  const [dob, setDob] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setDob(null);
    void (async () => {
      try {
        const { data } = await supabase.from("profiles").select("date_of_birth").eq("id", patientId).maybeSingle();
        if (alive) setDob(data?.date_of_birth ?? null);
      } catch {
        // no age: the base suggestion applies
      }
    })();
    return () => {
      alive = false;
    };
  }, [patientId]);
  return ageYearsOn(dob, nowMs);
}
