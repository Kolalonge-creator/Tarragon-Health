"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_GLUCOSE_DISPLAY_UNIT, type GlucoseDisplayUnit } from "@tarragon/shared";

/**
 * Supplies the reader's glucose display unit to the client components that
 * render a glucose figure (vitals history, the trend chart, the CGM card, the
 * entry form's unit default, the diabetes guidance thresholds).
 *
 * A context rather than a prop threaded through each call site: these
 * components are reached from several parents (Overview, Vitals, the
 * medications section), and a prop that one parent forgets to pass is a
 * component silently back on hardcoded mmol/L — exactly the bug this whole
 * change exists to remove. The default here is the Nigerian one, so a
 * component rendered outside the provider degrades to the right answer for
 * most patients instead of to the old wrong one for all of them.
 */
const GlucoseUnitContext = createContext<GlucoseDisplayUnit>(DEFAULT_GLUCOSE_DISPLAY_UNIT);

export function GlucoseUnitProvider({
  unit,
  children,
}: {
  unit: GlucoseDisplayUnit;
  children: ReactNode;
}) {
  return <GlucoseUnitContext.Provider value={unit}>{children}</GlucoseUnitContext.Provider>;
}

export function useGlucoseUnit(): GlucoseDisplayUnit {
  return useContext(GlucoseUnitContext);
}
