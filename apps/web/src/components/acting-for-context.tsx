"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Whose account the browser is showing, when the signed-in person is managing someone else's (acting for them). Set once
 * by the patient layout from the server's own check (getActingFor, which re-verifies the live grant on every request); the
 * browser only reads it to decide what to offer, never to grant anything. Null everywhere else, including staff pages.
 */
export type ActingForView = { fullName: string | null } | null;

const ActingForContext = createContext<ActingForView>(null);

export function ActingForProvider({ value, children }: { value: ActingForView; children: ReactNode }) {
  return <ActingForContext.Provider value={value}>{children}</ActingForContext.Provider>;
}

export function useActingFor(): ActingForView {
  return useContext(ActingForContext);
}

/**
 * Shown in place of an upload form while managing someone's account. Patient uploads always file under the signed-in
 * person (the server refuses them while acting: lib/acting/upload-while-acting.ts), so the form is not offered at all.
 */
export function UploadOffWhileActing({ acting }: { acting: NonNullable<ActingForView> }) {
  const first = acting.fullName?.trim().split(/\s+/)[0];
  return (
    <p className="rounded-lg border border-charcoal-ink/10 bg-charcoal-ink/[0.03] p-3 text-xs text-charcoal-ink/70 dark:border-night-ink/15 dark:bg-night-ink/5 dark:text-night-ink/70">
      Uploading is off while you manage {first ? `${first}'s` : "this"} account, because the file would be saved to your
      own record. {first ?? "They"} can upload it from their own account.
    </p>
  );
}
