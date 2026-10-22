/** @jest-environment jsdom */
import { describe, expect, it } from "@jest/globals";
import { fireEvent, render } from "@testing-library/react";
import { lengthToCm, temperatureToC, weightToKg } from "@tarragon/shared";
import { UnitConvertedInput } from "./unit-converted-input";

function submitted(container: HTMLElement): Record<string, string> {
  const form = container.querySelector("form") as HTMLFormElement;
  return Object.fromEntries([...new FormData(form).entries()].map(([k, v]) => [k, String(v)]));
}

describe("UnitConvertedInput", () => {
  it("in the stored unit is a plain named field", () => {
    const { container } = render(
      <form><UnitConvertedInput id="w" name="weight_kg" typedIsStored toStored={(v) => v} decimals={1} /></form>,
    );
    const input = container.querySelector("#w") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "70" } });
    expect(submitted(container)).toEqual({ weight_kg: "70" });
  });

  it("submits the stored unit under the stored name when typed in pounds", () => {
    const { container } = render(
      <form><UnitConvertedInput id="w" name="weight_kg" typedIsStored={false} toStored={(v) => weightToKg(v, "lb")} decimals={1} /></form>,
    );
    fireEvent.input(container.querySelector("#w") as HTMLInputElement, { target: { value: "154.3" } });
    // only the converted value is submitted; the typed figure has no name
    expect(submitted(container)).toEqual({ weight_kg: "70" });
  });

  it("clears the submitted value when the form is reset, so a saved reading is not sent again", () => {
    const { container } = render(
      <form><UnitConvertedInput id="w" name="weight_kg" typedIsStored={false} toStored={(v) => weightToKg(v, "lb")} decimals={1} /></form>,
    );
    fireEvent.change(container.querySelector("#w") as HTMLInputElement, { target: { value: "154.3" } });
    fireEvent.input(container.querySelector("#w") as HTMLInputElement, { target: { value: "154.3" } });
    expect(submitted(container)).toEqual({ weight_kg: "70" });
    (container.querySelector("form") as HTMLFormElement).reset();
    expect(submitted(container)).toEqual({ weight_kg: "" });
  });

  it("converts Fahrenheit and inches, and submits nothing for an empty field", () => {
    const { container, rerender } = render(
      <form><UnitConvertedInput id="t" name="temperature_c" typedIsStored={false} toStored={(v) => temperatureToC(v, "f")} decimals={1} /></form>,
    );
    expect(submitted(container)).toEqual({ temperature_c: "" });
    fireEvent.input(container.querySelector("#t") as HTMLInputElement, { target: { value: "98.6" } });
    expect(submitted(container)).toEqual({ temperature_c: "37" });
    rerender(<form><UnitConvertedInput id="t" name="waist_cm" typedIsStored={false} toStored={(v) => lengthToCm(v, "in")} decimals={1} /></form>);
    fireEvent.input(container.querySelector("#t") as HTMLInputElement, { target: { value: "35" } });
    expect(submitted(container)).toEqual({ waist_cm: "88.9" });
  });
});
