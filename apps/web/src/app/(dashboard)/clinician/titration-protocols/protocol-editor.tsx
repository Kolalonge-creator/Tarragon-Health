"use client";

import { useActionState, useState } from "react";
import { checkProtocolAction, saveProtocolDraftAction } from "./actions";
import { INITIAL_CHECK_STATE, type CheckState } from "@/lib/protocols/titration-review";

const FIELD = "mt-1 w-full rounded-lg border border-charcoal-ink/20 px-3 py-2 text-sm";
const BUTTON = "rounded-lg px-4 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green disabled:opacity-60";

function Result({ state }: { state: CheckState }) {
  if (state.kind === "idle") return null;
  const good = state.kind === "valid" || state.kind === "saved";
  return (
    <div role={good ? "status" : "alert"} className={`rounded-xl border p-3 text-sm ${good ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-red-300 bg-red-50 text-red-900"}`}>
      {state.messages.length === 1 ? (
        <p>{state.messages[0]}</p>
      ) : (
        <ul className="list-disc space-y-1 pl-5">
          {state.messages.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Empty by default. Nothing is pre-filled: the step table is the Chief Medical Officer's own. */
export function ProtocolEditor() {
  const [checkState, checkAction, checking] = useActionState(checkProtocolAction, INITIAL_CHECK_STATE);
  const [saveState, saveAction, saving] = useActionState(saveProtocolDraftAction, INITIAL_CHECK_STATE);
  const [code, setCode] = useState("");
  const [definition, setDefinition] = useState("");
  const [note, setNote] = useState("");
  const shown = saveState.kind !== "idle" ? saveState : checkState;

  return (
    <form className="space-y-3" aria-label="Write a step table">
      <label className="block text-sm text-charcoal-ink">
        Protocol code
        <input name="code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" spellCheck={false} className={FIELD} />
        <span className="mt-1 block text-xs text-charcoal-ink/60">Lowercase letters, digits and underscores. The blood pressure step table the app reads is called htn_hearts_ng.</span>
      </label>
      <label className="block text-sm text-charcoal-ink">
        Definition (JSON)
        <textarea name="definition" value={definition} onChange={(e) => setDefinition(e.target.value)} rows={16} spellCheck={false} className={`${FIELD} font-mono`} />
      </label>
      <label className="block text-sm text-charcoal-ink">
        Note (optional)
        <textarea name="note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} className={FIELD} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" formAction={checkAction} disabled={checking || saving} className={`${BUTTON} border border-charcoal-ink/20 text-charcoal-ink`}>
          {checking ? "Checking" : "Check"}
        </button>
        <button type="submit" formAction={saveAction} disabled={checking || saving} className={`${BUTTON} bg-brand-green text-white hover:opacity-90`}>
          {saving ? "Saving" : "Save as draft"}
        </button>
      </div>
      <Result state={shown} />
    </form>
  );
}
