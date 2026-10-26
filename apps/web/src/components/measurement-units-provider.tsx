"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_MEASUREMENT_UNITS, type MeasurementUnits } from "@tarragon/shared";

/**
 * The reader's weight, temperature and length display units, for the client components that show or
 * take one of those figures (the entry form, the history list, the trend chart). A context for the same
 * reason as GlucoseUnitProvider: a prop one parent forgets to pass is a card silently back on kg / degrees C.
 * Outside the provider the default is the metric one the app has always used.
 */
const MeasurementUnitsContext = createContext<MeasurementUnits>(DEFAULT_MEASUREMENT_UNITS);

export function MeasurementUnitsProvider({ units, children }: { units: MeasurementUnits; children: ReactNode }) {
  return <MeasurementUnitsContext.Provider value={units}>{children}</MeasurementUnitsContext.Provider>;
}

export function useMeasurementUnits(): MeasurementUnits {
  return useContext(MeasurementUnitsContext);
}
