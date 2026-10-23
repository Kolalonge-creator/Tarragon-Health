import { useEffect, useState } from "react";
import { View } from "react-native";
import { queueNoteView, t } from "@tarragon/i18n";
import { getOutboxSummary } from "@/lib/outbox";
import { supabase } from "@/lib/supabase";
import { space } from "@/ui/design";
import { AppText, Badge } from "@/ui/kit";

const REFRESH_MS = 5_000;

/**
 * How many entries this phone is holding that have not reached the server (the same outbox the sync banner reads), refreshed
 * every few seconds. Zero when the read fails: a failed read of the local queue must never blank or break a log form.
 */
export function usePendingLogCount(): number {
  const [waiting, setWaiting] = useState(lastKnown);
  useEffect(() => subscribe(setWaiting), []);
  return waiting;
}

// One shared poller, however many log buttons are on screen (a medicines list has one per dose).
let lastKnown = 0;
const listeners = new Set<(n: number) => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let authWatch: { unsubscribe: () => void } | null = null;

function publish(n: number) {
  lastKnown = n;
  listeners.forEach((fn) => fn(n));
}

function readOnce() {
  getOutboxSummary()
    .then((s) => publish(s.waiting))
    // A failed read must not leave an old number on screen (on a shared phone it could be another account's).
    .catch(() => publish(0));
}

function subscribe(fn: (n: number) => void): () => void {
  listeners.add(fn);
  if (listeners.size === 1) {
    // Signing in, out or switching account clears the number at once, then reads the new account's queue.
    authWatch = supabase.auth.onAuthStateChange(() => {
      publish(0);
      readOnce();
    }).data.subscription;
    readOnce();
    timer = setInterval(readOnce, REFRESH_MS);
  } else {
    fn(lastKnown);
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) {
      if (timer) clearInterval(timer);
      timer = null;
      authWatch?.unsubscribe();
      authWatch = null;
      lastKnown = 0;
    }
  };
}

/**
 * UI-C change 10: put under a log button. When something is waiting to send it says so in one calm sentence and shows a small
 * count badge; with nothing waiting it renders nothing, so a healthy phone shows no extra line. Words and number, never colour alone.
 */
export function LogQueueNote() {
  const view = queueNoteView(usePendingLogCount());
  if (!view.show) return null;
  return (
    <View accessibilityRole="text" accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}>
      <AppText variant="caption" tone="textMuted" style={{ flexShrink: 1 }}>
        {t("offline.saved_note")}
      </AppText>
      <Badge label={t(view.badgeKey, "en", { count: view.count })} tone="neutral" />
    </View>
  );
}
