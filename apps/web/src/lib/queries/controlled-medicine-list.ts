"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  fallbackControlledMedicineList,
  loadControlledMedicineList,
  type ControlledMedicineList,
} from "@/lib/rules/controlled-medicine-list";

/**
 * The controlled-medicine list for client screens (OQ-484): the database list through `get_controlled_medicine_list`, the generated fallback while it
 * loads or if it cannot be read. Nothing here throws, so the guard never silently turns off. Read once per page load and shared by every screen.
 * (A plain effect rather than a React Query hook so the two screens that use it work with or without a query provider around them.)
 */
let inFlight: Promise<ControlledMedicineList> | null = null;
let loaded: ControlledMedicineList | null = null;

function loadOnce(): Promise<ControlledMedicineList> {
  if (!inFlight) {
    inFlight = (async () => {
      try {
        const list = await loadControlledMedicineList(createClient());
        if (list.source === "database") loaded = list;
        return list;
      } catch {
        return fallbackControlledMedicineList();
      } finally {
        // a failed read is retried by the next screen that asks
        if (!loaded) inFlight = null;
      }
    })();
  }
  return inFlight;
}

export function useControlledMedicineList(): ControlledMedicineList {
  const [list, setList] = useState<ControlledMedicineList>(() => loaded ?? fallbackControlledMedicineList());
  useEffect(() => {
    let cancelled = false;
    void loadOnce().then((next) => {
      if (!cancelled) setList(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return list;
}
