import { useEffect, useState } from "react";
import { PATIENT_PAGE_GATES, hiddenMobileSections, type PatientGateAnswers, type PatientGateId } from "@tarragon/shared";
import { supabase } from "./supabase";
import { listRecordsRequests } from "./records-requests";

/**
 * Menu sections whose go-live guard is off, to leave out of the More menu and its search (the same list and rules as web, in
 * `@tarragon/shared` patient-page-gates). It reads the guard the screen itself uses; a guard that cannot be read counts as closed. A screen the
 * person already holds something on (a booked visit, a records request) stays. Nothing is switched on, and the screen itself is untouched.
 */
async function guardOpen(key: string): Promise<boolean | null> {
  try {
    const { data, error } = await supabase.rpc("go_live_guard_is_open", { p_key: key });
    return error || typeof data !== "boolean" ? null : data;
  } catch {
    return null;
  }
}

async function holds(id: PatientGateId, patientId: string): Promise<boolean | null> {
  try {
    if (id === "appointments") {
      const { count, error } = await supabase.from("appointments").select("id", { count: "exact", head: true }).eq("patient_id", patientId);
      return error || count === null ? null : count > 0;
    }
    if (id === "recordsRequests") return (await listRecordsRequests()).length > 0;
    return null;
  } catch {
    return null;
  }
}

export async function loadHiddenSections(patientId: string): Promise<string[]> {
  const wanted = PATIENT_PAGE_GATES.filter((g) => g.mobileSection !== null);
  const answers: PatientGateAnswers = {};
  await Promise.all(
    wanted.map(async (g) => {
      const [open, held] = await Promise.all([guardOpen(g.guard), g.holdable ? holds(g.id, patientId) : Promise.resolve(null)]);
      answers[g.id] = { guardOpen: open, holds: held };
    }),
  );
  return hiddenMobileSections(answers);
}

/**
 * While the answer is unknown, nothing is hidden (the menu never flickers an entry away from someone who holds it); once it arrives, closed
 * entries drop out. A failed read counts as closed for the guard only, as in `isGateHidden`.
 */
export function useHiddenSections(patientId: string, ready: boolean): string[] {
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    if (!ready) return undefined;
    let cancelled = false;
    void loadHiddenSections(patientId).then((h) => {
      if (!cancelled) setHidden(h);
    });
    return () => {
      cancelled = true;
    };
  }, [patientId, ready]);
  return hidden;
}
