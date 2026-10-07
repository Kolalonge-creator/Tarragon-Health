"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addMemoryItemAction,
  deleteAllMemoryAction,
  deleteMemoryItemAction,
  exportMemoryAction,
  getMemoryStateAction,
  setMemoryConsentAction,
  updateMemoryItemAction,
  type MemoryState,
} from "@/lib/ai-coach/memory-actions";

/**
 * S52 (spec 7.12): "What I remember about you". OFF by default. The patient switches it on (their own consent, with the wording version
 * recorded), then adds goals and preferences in their own words, and can change, remove, remove everything, or export them at any time.
 * It never stores health details (the database refuses them) and the assistant reads it only while it is on.
 */
export function AssistantMemoryCard() {
  const [state, setState] = useState<MemoryState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<"goal" | "preference">("goal");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [exported, setExported] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setState(await getMemoryStateAction());
    setLoaded(true);
  }, []);
  useEffect(() => {
    let live = true;
    void getMemoryStateAction().then((next) => {
      if (!live) return;
      setState(next);
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, []);

  async function run(step: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    const r = await step();
    if (!r.ok) setError(r.error ?? "Something went wrong.");
    await refresh();
    return r.ok;
  }

  if (!loaded || !state) return null;
  if (!state.available) {
    return (
      <details className="rounded-md border border-charcoal-ink/10 dark:border-night-ink/15 p-2 text-xs text-charcoal-ink/70 dark:text-night-ink/70">
        <summary className="cursor-pointer font-medium">What I remember about you</summary>
        <p className="pt-1">The memory is not switched on yet. Nothing is remembered about you.</p>
      </details>
    );
  }

  return (
    <details className="rounded-md border border-charcoal-ink/10 dark:border-night-ink/15 p-2 text-sm" open={state.consented}>
      <summary className="cursor-pointer text-xs font-medium">What I remember about you</summary>
      <div className="space-y-2 pt-2">
        {!state.consented ? (
          <div className="space-y-2">
            <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">
              If you switch this on, I will remember the goals and preferences you write here, so I can be more helpful from one chat to the
              next. I never remember health details. You can change, remove or export everything at any time, and switch it off.
            </p>
            <Button type="button" size="sm" onClick={() => void run(() => setMemoryConsentAction(true))}>
              Switch the memory on
            </Button>
          </div>
        ) : (
          <>
            <ul className="space-y-1">
              {state.items.length === 0 && <li className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">Nothing yet.</li>}
              {state.items.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-xs uppercase text-charcoal-ink/50 dark:text-night-ink/50">{item.kind === "goal" ? "Goal" : "Preference"}</span>
                  {editing?.id === item.id ? (
                    <>
                      <Input
                        aria-label="Change this item"
                        value={editing.text}
                        maxLength={state.maxChars}
                        onChange={(e) => setEditing({ id: item.id, text: e.target.value })}
                        className="h-8 flex-1"
                      />
                      <Button type="button" size="sm" onClick={async () => { if (await run(() => updateMemoryItemAction(item.id, editing.text))) setEditing(null); }}>
                        Save
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1">{item.text}</span>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing({ id: item.id, text: item.text })}>
                        Change
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => void run(() => deleteMemoryItemAction(item.id))}>
                        Remove
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
            <form
              className="flex flex-wrap gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await run(() => addMemoryItemAction({ kind, text: draft }))) setDraft("");
              }}
            >
              <select
                aria-label="Goal or preference"
                className="h-9 rounded-md border border-charcoal-ink/20 dark:border-night-ink/25 bg-white dark:bg-night-card px-2 text-sm"
                value={kind}
                onChange={(e) => setKind(e.target.value === "preference" ? "preference" : "goal")}
              >
                <option value="goal">Goal</option>
                <option value="preference">Preference</option>
              </select>
              <Input
                aria-label="What to remember"
                placeholder="For example: walk after dinner"
                value={draft}
                maxLength={state.maxChars}
                onChange={(e) => setDraft(e.target.value)}
                className="flex-1"
              />
              <Button type="submit" size="sm" disabled={draft.trim().length < 3 || state.items.length >= state.maxItems}>
                Remember
              </Button>
            </form>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={async () => { const r = await exportMemoryAction(); if (r.ok) setExported(r.json); else setError(r.error); }}>
                Export
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => void run(() => deleteAllMemoryAction())}>
                Remove everything
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => {
                  if (window.confirm("Switch the memory off? This also removes everything it remembers. Export first if you want a copy.")) {
                    void run(() => setMemoryConsentAction(false));
                  }
                }}
              >
                Switch the memory off
              </Button>
            </div>
            {exported && (
              <textarea readOnly aria-label="Your exported memory" className="min-h-24 w-full rounded-md border border-charcoal-ink/20 dark:border-night-ink/25 bg-white dark:bg-night-card p-2 text-xs" value={exported} />
            )}
          </>
        )}
        {error && <p className="text-sm text-red-600 dark:text-red-300">{error}</p>}
      </div>
    </details>
  );
}
