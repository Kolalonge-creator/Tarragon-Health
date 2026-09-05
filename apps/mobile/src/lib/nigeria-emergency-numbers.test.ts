/**
 * The emergency numbers are bundled in the binary specifically so they render
 * with zero signal, on the one screen where being wrong or blank is a
 * real-harm outcome rather than a cosmetic bug. These tests pin the actual
 * numbers (verified against official sources — see the source file's comment)
 * and the "never empty" contract.
 */
import { getEmergencyNumbers } from "./nigeria-emergency-numbers";

const NATIONAL = { label: "National Emergency Line", number: "112", tel: "112" };

it("returns the national line for a patient with no state on file", () => {
  expect(getEmergencyNumbers(null)).toEqual([NATIONAL]);
  expect(getEmergencyNumbers(undefined)).toEqual([NATIONAL]);
  expect(getEmergencyNumbers("")).toEqual([NATIONAL]);
});

it("returns the national line for any state with no verified state-run line", () => {
  for (const state of ["Abia", "Kano", "Rivers", "Abuja", "Oyo"]) {
    expect(getEmergencyNumbers(state)).toEqual([NATIONAL]);
  }
});

it("returns Lagos's verified lines, with 112 still first", () => {
  expect(getEmergencyNumbers("Lagos")).toEqual([
    NATIONAL,
    { label: "Lagos State Emergency (toll-free)", number: "767", tel: "767" },
    { label: "LASEMS / LASAMBUS Ambulance", number: "123", tel: "123" },
  ]);
});

it("matches the canonical state value exactly, and falls back rather than guessing", () => {
  // profiles.state is expected to carry the canonical value; anything else
  // must degrade to the national line, which reaches Lagos too.
  expect(getEmergencyNumbers("lagos")).toEqual([NATIONAL]);
  expect(getEmergencyNumbers("Lagos State")).toEqual([NATIONAL]);
});

/**
 * Regression guard for the fix in the source file: a bare truthy index into
 * an object literal also matches Object.prototype members, which returned a
 * Function from a function contractually guaranteed to return a non-empty
 * array of numbers.
 */
it.each(["toString", "constructor", "valueOf", "__proto__", "hasOwnProperty"])(
  "returns real numbers, not an inherited Object.prototype member, for %s",
  (state) => {
    expect(getEmergencyNumbers(state)).toEqual([NATIONAL]);
  }
);

it("never returns an empty list", () => {
  for (const state of [null, undefined, "", "Lagos", "Kano", "nonsense"]) {
    expect(getEmergencyNumbers(state).length).toBeGreaterThan(0);
  }
});
