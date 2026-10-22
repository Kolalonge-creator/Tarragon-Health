"use client";

import { useState, useTransition } from "react";
import {
  HOME_PIN_GROUPS,
  HOME_PIN_GROUP,
  HOME_PIN_GROUP_LABEL,
  HOME_PIN_KEYS,
  HOME_PIN_LABEL,
  MAX_HOME_PINS,
  movePin,
  togglePin,
  type HomePinKey,
} from "@tarragon/shared";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { saveHomePins } from "@/app/(dashboard)/patient/home-pins-actions";

const ROW = "flex items-center justify-between gap-3 rounded-lg px-2 py-1.5";
const SMALL_BTN =
  "rounded-md border border-charcoal-ink/15 px-2 py-1 text-sm disabled:opacity-40 dark:border-night-ink/20";

/**
 * "Customise" for the pinned tiles: choose which tiles show and in what order.
 * Pins the care plan relies on (today's doses, for anyone taking a medication)
 * are shown but cannot be switched off.
 */
export function ManageHomePins({
  initialPins,
  lockedPins,
}: {
  initialPins: readonly HomePinKey[];
  lockedPins: readonly HomePinKey[];
}) {
  const [open, setOpen] = useState(false);
  const [pins, setPins] = useState<HomePinKey[]>([...initialPins]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function openDialog() {
    setPins([...initialPins]);
    setError(null);
    setOpen(true);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveHomePins(pins);
      if (result.ok) setOpen(false);
      else setError(result.error);
    });
  }

  const atLimit = pins.length >= MAX_HOME_PINS;

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={openDialog}>
        Customise
      </Button>
      <ConfirmDialog
        open={open}
        title="Your home screen"
        description={`Pick up to ${MAX_HOME_PINS} things to keep in view, and put them in the order you like.`}
        confirmLabel={pending ? "Saving..." : "Save"}
        confirmDisabled={pending}
        onConfirm={save}
        onCancel={() => setOpen(false)}
      >
        <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
          {pins.length > 0 && (
            <section aria-labelledby="pin-order-heading" className="space-y-1">
              <h3 id="pin-order-heading" className="text-sm font-medium">
                Showing now
              </h3>
              <ol className="space-y-1">
                {pins.map((key, index) => (
                  <li key={key} className={ROW}>
                    <span className="text-sm">{HOME_PIN_LABEL[key]}</span>
                    <span className="flex gap-1">
                      <button
                        type="button"
                        className={SMALL_BTN}
                        disabled={index === 0}
                        aria-label={`Move ${HOME_PIN_LABEL[key]} up`}
                        onClick={() => setPins((p) => movePin(p, key, "up"))}
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        className={SMALL_BTN}
                        disabled={index === pins.length - 1}
                        aria-label={`Move ${HOME_PIN_LABEL[key]} down`}
                        onClick={() => setPins((p) => movePin(p, key, "down"))}
                      >
                        Down
                      </button>
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {HOME_PIN_GROUPS.map((group) => (
            <fieldset key={group} className="space-y-1">
              <legend className="text-sm font-medium">{HOME_PIN_GROUP_LABEL[group]}</legend>
              {HOME_PIN_KEYS.filter((key) => HOME_PIN_GROUP[key] === group).map((key) => {
                const checked = pins.includes(key);
                const locked = lockedPins.includes(key);
                return (
                  <label key={key} className={`${ROW} cursor-pointer`}>
                    <span className="text-sm">
                      {HOME_PIN_LABEL[key]}
                      {locked && (
                        <span className="ml-2 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                          Stays on while you have a medication
                        </span>
                      )}
                    </span>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={locked || (!checked && atLimit)}
                      onChange={() => setPins((p) => togglePin(p, key, lockedPins))}
                    />
                  </label>
                );
              })}
            </fieldset>
          ))}
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}
