"use client";

import { useEffect, useRef, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";

/**
 * A number field typed in the patient's own unit (lb, degrees F, inches) that submits the stored unit
 * (kg, degrees C, cm) under `name`. The typed figure lives in a nameless, uncontrolled input and a hidden input
 * carries the converted, rounded value, so the form's validation, plausibility check and server action keep seeing
 * exactly what they always have. In the stored unit the field renders as a plain named input, unchanged.
 *
 * Uncontrolled on purpose: React resets the form after an action, which empties the visible field, and the hidden
 * value is cleared on the same `reset` event so a reading that was just saved can never be sent a second time unseen.
 * Keyed by the caller on the unit, so changing the setting starts the field empty instead of reinterpreting a half-typed figure.
 */
export function UnitConvertedInput({
  name,
  typedIsStored,
  toStored,
  decimals,
  step,
  ...inputProps
}: Omit<ComponentProps<typeof Input>, "name" | "value" | "defaultValue" | "onChange"> & {
  /** The form field name the server expects (weight_kg, temperature_c, waist_cm). */
  name: string;
  /** True when the patient's unit already is the stored one: render the plain field. */
  typedIsStored: boolean;
  /** Typed figure in the patient's unit -> the stored unit. */
  toStored: (typed: number) => number;
  /** Decimal places kept on the stored figure. */
  decimals: number;
}) {
  const hiddenRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const form = hiddenRef.current?.form;
    if (!form) return;
    const clear = () => {
      if (hiddenRef.current) hiddenRef.current.value = "";
    };
    form.addEventListener("reset", clear);
    return () => form.removeEventListener("reset", clear);
  }, []);

  if (typedIsStored) return <Input name={name} step={step} {...inputProps} />;

  function onInput(e: React.FormEvent<HTMLInputElement>) {
    const raw = e.currentTarget.value.trim();
    const n = raw === "" ? Number.NaN : Number(raw);
    const f = 10 ** decimals;
    if (hiddenRef.current) hiddenRef.current.value = Number.isFinite(n) ? String(Math.round(toStored(n) * f) / f) : "";
  }

  // The step belongs to the stored unit; a figure typed in lb, F or inches can fall anywhere between its steps.
  return (
    <>
      <Input {...inputProps} step="any" onInput={onInput} />
      <input ref={hiddenRef} type="hidden" name={name} defaultValue="" />
    </>
  );
}
