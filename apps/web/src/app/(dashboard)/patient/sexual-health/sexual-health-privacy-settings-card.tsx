"use client";

import { type FormEvent, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SEMANTIC_ICON } from "@/lib/icons";
import {
  useSexualHealthPrivacyStatus,
  useSetSexualHealthPin,
  useClearSexualHealthPin,
} from "@/lib/queries/sexual-health-privacy";

/**
 * Set up, change, or remove the privacy PIN gating this whole hub (spec
 * §47.2) — entirely optional, off by default. Lives inside the hub itself
 * (not the gate screen) since setting one up is a choice made once already
 * unlocked; changing/removing an existing one needs no old-PIN confirmation
 * (set_sexual_health_pin is a plain upsert) because the patient's real,
 * already-authenticated session already proves who they are — the same
 * accessibility-first reasoning as the gate's own "Forgot your PIN?" link.
 */
export function SexualHealthPrivacySettingsCard() {
  const status = useSexualHealthPrivacyStatus();
  const setPin = useSetSexualHealthPin();
  const clearPin = useClearSexualHealthPin();
  const [editing, setEditing] = useState(false);
  const [pin, setPinValue] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  const hasPin = !!status.data?.hasPin;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!/^\d{4,6}$/.test(pin)) {
      setError("PIN must be 4 to 6 digits.");
      return;
    }
    if (pin !== confirmPin) {
      setError("The two PINs don't match.");
      return;
    }
    setPin.mutate(pin, {
      onSuccess: () => {
        setEditing(false);
        setPinValue("");
        setConfirmPin("");
      },
      onError: () => setError("Couldn't save that PIN. Please try again."),
    });
  }

  return (
    <Card variant="soft">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <SEMANTIC_ICON.privacy className="h-4 w-4 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} aria-hidden />
          Privacy PIN
        </CardTitle>
        <CardDescription>
          {hasPin
            ? "This section asks for a PIN before it opens, useful on a shared phone."
            : "Add a PIN so this section doesn't open right away on a shared phone. Completely optional."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!editing && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
              {hasPin ? "Change PIN" : "Set up a PIN"}
            </Button>
            {hasPin && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={clearPin.isPending}
                onClick={() => clearPin.mutate()}
              >
                {clearPin.isPending ? "Removing…" : "Remove PIN"}
              </Button>
            )}
          </div>
        )}

        {editing && (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="sh-new-pin">New PIN (4-6 digits)</Label>
                <Input
                  id="sh-new-pin"
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={pin}
                  onChange={(event) => setPinValue(event.target.value.replace(/\D/g, ""))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sh-confirm-pin">Confirm PIN</Label>
                <Input
                  id="sh-confirm-pin"
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={confirmPin}
                  onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, ""))}
                />
              </div>
            </div>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={setPin.isPending}>
                {setPin.isPending ? "Saving…" : "Save PIN"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setPinValue("");
                  setConfirmPin("");
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
