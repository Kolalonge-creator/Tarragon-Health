"use client";

import { useState, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";

/**
 * A number field typed in the patient's own unit (lb, degrees F, inches) that submits the stored unit
 * (kg, degrees C, cm) under `name`. The typed figure lives in a nameless input and a hidden input carries the
 * converted, rounded value, so the form's validation, plausibility check and server action keep seeing exactly
 * what they always have. In the stored unit the field renders as a plain named input, unchanged.
 */
export function UnitConvertedInput({
  name,
  typedIsStored,
  toStored,
  decimals,
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
  const [typed, setTyped] = useState("");
  if (typedIsStored) return <Input name={name} {...inputProps} />;

  const n = typed.trim() === "" ? Number.NaN : Number(typed);
  const f = 10 ** decimals;
  const stored = Number.isFinite(n) ? String(Math.round(toStored(n) * f) / f) : "";
  return (
    <>
      <Input {...inputProps} value={typed} onChange={(e) => setTyped(e.target.value)} />
      <input type="hidden" name={name} value={stored} />
    </>
  );
}
