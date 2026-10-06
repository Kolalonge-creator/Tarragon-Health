import { AppState } from "react-native";
import { supabase } from "../supabase";
import { writtenQuestionQueue } from "./queue-instance";

const RETRY_TICK_MS = 60_000;

/**
 * Starts the retry triggers for the signed-in patient: now, every time the app returns to the
 * foreground, right after a sign-in, and on a slow timer that respects each item's back-off (the
 * app has no connectivity listener, so the timer is how "signal came back" is noticed). Returns a
 * stop function. A flush only ever touches the signed-in patient's own items.
 */
export function startWrittenQuestionFlushing(userId: string, onChange?: () => void): () => void {
  const run = (force: boolean) => {
    void writtenQuestionQueue
      .flush(userId, { force })
      .then(() => onChange?.())
      .catch(() => undefined);
  };
  run(true);
  const app = AppState.addEventListener("change", (state) => {
    if (state === "active") run(true);
  });
  const auth = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" && session?.user.id === userId) run(true);
  });
  const timer = setInterval(() => run(false), RETRY_TICK_MS);
  return () => {
    app.remove();
    auth.data.subscription.unsubscribe();
    clearInterval(timer);
  };
}
