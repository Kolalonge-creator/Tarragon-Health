"use client";

import { useEffect, useState } from "react";

/**
 * React resets every uncontrolled field in an action-bound `<form>` at
 * *submit* time — confirmed directly in react-dom's own source
 * (`requestFormReset$1` is called before the bound action itself is even
 * invoked, inside `startHostTransition`), not "once the action returns" as
 * an earlier version of this comment claimed. Two consequences follow from
 * that timing, not one:
 *
 * 1. Every submission — including one that goes on to succeed — briefly
 *    resets the form to whatever `defaultValue` was set at the *previous*
 *    render, before this hook's remount (driven by the action's eventual
 *    result) re-populates it. On a first attempt that previous value is
 *    empty, so there is a real, brief visible reset even on a submission
 *    that turns out fine — this hook does not, and structurally cannot on
 *    its own, eliminate that: it only fixes what happens *after* the
 *    action resolves, which is the failure case that used to be
 *    permanent (the field stayed blank forever, forcing a full retype)
 *    rather than transient.
 * 2. A fresh `defaultValue` computed from the newly-returned state can't
 *    just be passed as a prop update: an already-mounted input/select
 *    ignores a changed `defaultValue`. Re-keying the `<form>` forces a
 *    remount, which is what lets it actually apply. (Shared between
 *    signup-form.tsx, patient-location-form.tsx and risk-assessment-form.tsx,
 *    which all hit this; see any of their git history for the concrete bug
 *    this fixes — a failed submission silently wiping every field the
 *    visitor had already filled in correctly, permanently rather than
 *    just for the moment described in (1).)
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
