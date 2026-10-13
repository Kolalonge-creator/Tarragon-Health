"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useStaffAction, StaffMessage } from "./use-staff-action";
import { DISPLAY_NAME_PATTERN, type DisplayNameCallbacks } from "./staff-types";

/** How the signed-in staff member appears to members. Empty clears it. Nothing shows to members until they choose to set one. */
export function DisplayNameForm({ onSave }: DisplayNameCallbacks) {
  const uid = useId();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { message, pending, run } = useStaffAction();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed !== "" && !DISPLAY_NAME_PATTERN.test(trimmed)) {
      return setError("Use letters, spaces, commas, full stops, hyphens and apostrophes only, 2 to 40 characters. No numbers.");
    }
    setError(null);
    run(() => onSave({ name: trimmed }));
  }

  return (
    <section aria-labelledby={`${uid}-h`} className="space-y-3 rounded-lg border border-charcoal-ink/10 bg-white p-4">
      <h2 id={`${uid}-h`} className="font-heading text-base font-semibold text-charcoal-ink">
        How members see me
      </h2>
      <p id={`${uid}-help`} className="text-sm text-charcoal-ink/70">
        If you set a name, members see it and your role at the top of the groups you are assigned to. Nothing shows until you choose a name.
        Leave the box empty and save to remove it.
      </p>
      <form onSubmit={submit} className="space-y-2" noValidate>
        <label htmlFor={`${uid}-n`} className="block text-sm font-medium">
          Name members will see
        </label>
        <Input
          id={`${uid}-n`}
          value={name}
          maxLength={40}
          autoComplete="off"
          aria-describedby={`${uid}-help`}
          onChange={(e) => setName(e.target.value)}
        />
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <Button type="submit" size="sm" disabled={pending}>
          Save
        </Button>
      </form>
      <StaffMessage message={message} />
    </section>
  );
}
