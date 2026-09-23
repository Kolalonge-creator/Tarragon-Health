"use client";

import { useEffect, useState } from "react";

/**
 * React resets every uncontrolled field in an action-bound `<form>` once
 * the bound `useActionState` action returns — success or failure — so a
 * fresh `defaultValue` computed from the newly-returned state can't just be
 * passed as a prop: the already-mounted input/select ignores it. Re-keying
 * the `<form>` forces a remount, which is what lets `defaultValue` actually
 * apply. (Shared between signup-form.tsx and patient-location-form.tsx,
 * which both hit this; see either file's git history for the concrete bug
 * this fixes — a failed submission silently wiping every field the visitor
 * had already filled in correctly.)
 *
 * A full remount also throws keyboard/screen-reader focus to `document.body`
 * — nothing about that is specific to this pattern, it's how React (and the
 * DOM generally) handles any unmount/remount — so this restores it to
 * `focusId` once the remount lands. `focusId` should be a focusable element
 * (`tabIndex={-1}` is enough without adding it to the tab order) that
 * describes what happened, typically the error banner: this codebase's
 * `FormError` component is already built for exactly this (see its own
 * tabIndex={-1} comment).
 */
export function useRemountOnActionResult<T>(
  state: T,
  shouldRemount: (state: T) => boolean,
  focusId: string
): number {
  const [attempt, setAttempt] = useState(0);
  // Adjusted during render, not in an effect, so it can't cascade an extra
  // render — same pattern as the query-result prefills elsewhere in this
  // codebase (e.g. risk-assessment-form.tsx).
  const [lastState, setLastState] = useState(state);
  if (state !== lastState) {
    setLastState(state);
    if (shouldRemount(state)) setAttempt((n) => n + 1);
  }

  useEffect(() => {
    if (attempt > 0) document.getElementById(focusId)?.focus();
  }, [attempt, focusId]);

  return attempt;
}
