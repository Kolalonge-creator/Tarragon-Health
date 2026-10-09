import { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { loadGroupList } from "./api";
import { showCommunityEntry } from "./entry";

/**
 * Whether the Community entry belongs in the More menu for the signed-in account. Hidden while anything is unknown, for someone with a
 * supported person's account open, for a supporter-only account, while the go-live guard is off, and for anyone under 18 (see
 * entry.ts). Best-effort: a failed read simply leaves the entry hidden.
 */
export function useCommunityEntry(userId: string, acting: boolean, actingChecked: boolean): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!actingChecked || acting) {
      setVisible(false);
      return undefined;
    }
    void (async () => {
      try {
        const { data } = await supabase.from("profiles").select("receives_care").eq("id", userId).maybeSingle();
        const receivesCare = data ? data.receives_care : null;
        if (receivesCare !== true) {
          if (!cancelled) setVisible(false);
          return;
        }
        const list = await loadGroupList();
        if (!cancelled) setVisible(showCommunityEntry({ acting: false, receivesCare, list: list ?? undefined }));
      } catch {
        if (!cancelled) setVisible(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, acting, actingChecked]);

  return visible;
}
