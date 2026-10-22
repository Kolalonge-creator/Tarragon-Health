/**
 * Where a stored glucose reading sits against a line, judged the way a person reads it: in whole mg/dL.
 *
 * Readings are stored in mmol/L, but sensors report whole mg/dL (or tenths of a mmol/L, which land on the same whole numbers) and the consensus
 * lines are 54, 70, 180 and 250 mg/dL. Comparing the stored decimals directly, or rounding them to one decimal first, puts a reading next to a line
 * on the wrong side (181 mg/dL is 10.04 mmol/L: high, but "10.0" if rounded). One definition here so every time-in-range figure on the platform agrees.
 */
import { GLUCOSE_MMOL_TO_MGDL } from "@tarragon/shared";

/** The reading, or a line given in mmol/L, as whole mg/dL. */
export const wholeMgDl = (mmolL: number): number => Math.round(mmolL * GLUCOSE_MMOL_TO_MGDL);

/** Strictly below the line (a reading exactly on the line is not below it). */
export const isBelowLine = (readingMmolL: number, lineMmolL: number): boolean => wholeMgDl(readingMmolL) < wholeMgDl(lineMmolL);

/** Strictly above the line (a reading exactly on the line is not above it). */
export const isAboveLine = (readingMmolL: number, lineMmolL: number): boolean => wholeMgDl(readingMmolL) > wholeMgDl(lineMmolL);
