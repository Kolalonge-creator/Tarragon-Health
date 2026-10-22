/**
 * "Whose baby?" on a shared phone (S68b). One phone is often used by a household. At launch the app asks which child, and the answer is
 * remembered only until the app has been away longer than the picker's own window; a caregiver LABEL ("Mum", "Dad", "Aunty") is typed per entry
 * and is not an account. Anything about the mother (her mood check, a loss note, her cycle or pregnancy records) is a separate section behind the
 * S66 private lock, which re-asks on its own timer; choosing a different child also locks it again, so a baby change on a handed-over phone
 * never leaves her section open.
 */
export interface ChildChoice {
  readonly profileId: string;
  readonly firstName: string;
  /** manage: may log and see everything about the child. view: a second caregiver or partner who may only look. */
  readonly access: "manage" | "view";
}

export type ChildPickerState =
  | { readonly kind: "none" }
  | { readonly kind: "ask"; readonly choices: readonly ChildChoice[] }
  | { readonly kind: "chosen"; readonly child: ChildChoice; readonly choices: readonly ChildChoice[] };

/**
 * One child: no question needed. Several: ask, unless a remembered choice is still in force (`rememberedId` is cleared by the caller once the
 * remember window has passed). A remembered id that is no longer in the list is ignored, never trusted.
 */
export function pickerState(choices: readonly ChildChoice[], rememberedId: string | null): ChildPickerState {
  if (choices.length === 0) return { kind: "none" };
  if (choices.length === 1) return { kind: "chosen", child: choices[0] as ChildChoice, choices };
  const hit = rememberedId ? choices.find((c) => c.profileId === rememberedId) : undefined;
  return hit ? { kind: "chosen", child: hit, choices } : { kind: "ask", choices };
}

/** The private (mother) section must be locked again when the chosen child changes. */
export function mustRelockOnSwitch(previousId: string | null, nextId: string): boolean {
  return previousId !== null && previousId !== nextId;
}

/** A first name only, never a surname or a condition: it is shown on a shared screen. */
export function displayFirstName(fullName: string | null | undefined): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  return first.length > 0 ? first.slice(0, 24) : "Baby";
}

/** Builds the choices from the people this account supports: only minor children (never an adult dependant), and a view grant stays view. */
export function childChoices(
  supported: readonly { profileId: string; fullName: string | null; permissionLevel: "view" | "manage"; isDependentAccount: boolean; dependentKind: string | null }[],
): ChildChoice[] {
  return supported
    .filter((p) => p.isDependentAccount && p.dependentKind === "minor_child")
    .map((p) => ({ profileId: p.profileId, firstName: displayFirstName(p.fullName), access: p.permissionLevel }));
}

/** May this person add a record for the child? Only a manager. A view grant sees the child's timeline, growth chart and vaccine list and nothing else. */
export function mayLog(child: ChildChoice): boolean {
  return child.access === "manage";
}

export interface ChildSwitcher {
  /** The child now on screen. Relocks the private section if a DIFFERENT child was on screen before. */
  show(id: string): void;
  /** The person asked to switch child (before choosing): relock at once, so the private section is locked whoever is picked next. */
  leave(): void;
}

/**
 * The real "switch child" flow (S68b review fix). The first version compared the previous id AFTER the screen had cleared it, so a switch never
 * relocked. This keeps the child on screen in one place: `leave()` relocks when the person starts a switch, `show()` relocks when the child
 * changes without a `leave()` (a link, a back button). `relock` is the S66 lock's own `lock()` on the phone and on the web.
 */
export function createChildSwitcher(relock: () => void): ChildSwitcher {
  let shown: string | null = null;
  return {
    show(id) {
      if (shown !== null && mustRelockOnSwitch(shown, id)) relock();
      shown = id;
    },
    leave() {
      if (shown !== null) relock();
      shown = null;
    },
  };
}
