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
 * loads or if it cannot be read. Nothing here throws, so the guard never silently turns off. A good read is shared by every screen and kept for ten
 * minutes, so a long-open tab picks up a change by the CMO. (A plain effect rather than a React Query hook so the two screens that use it work with
 * or without a query provider around them.)
 */
const KEEP_MS = 10 * 60 * 1000;
let loaded: { list: ControlledMedicineList; at: number } | null = null;
let inFlight: Promise<ControlledMedicineList> | null = null;

async function read(): Promise<ControlledMedicineList> {
  try {
    const list = await loadControlledMedicineList(createClient());
    if (list.source === "database") loaded = { list, at: Date.now() };
    return list;
  } catch {
    return fallbackControlledMedicineList();
  }
}

function loadOnce(): Promise<ControlledMedicineList> {
  if (loaded && Date.now() - loaded.at < KEEP_MS) return Promise.resolve(loaded.list);
  // `read` never rejects; `finally` runs after the assignment below, so a failed read is retried by the next screen that asks
  inFlight ??= read().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export function useControlledMedicineList(): ControlledMedicineList {
  const [list, setList] = useState<ControlledMedicineList>(() => loaded?.list ?? fallbackControlledMedicineList());
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
