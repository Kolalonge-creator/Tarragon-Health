/**
 * @tarragon/shared — cross-app constants, enums, and helpers.
 *
 * Single source of truth for types shared between apps/web, apps/mobile,
 * and the typed ML client. Business rules per CLAUDE.md and
 * docs/ARCHITECTURE.md: NGN in kobo, E.164 phones, Africa/Lagos tz.
 */

export * from "./ml-client";

// Generated Supabase types: Database, Tables, TablesInsert, TablesUpdate,
// Enums, Constants, Json. Single source of truth for the DB schema.
export * from "./database.types";
import type { Enums } from "./database.types";

export const TIMEZONE = "Africa/Lagos" as const;

export const CURRENCY = {
  NGN: "NGN",
  GBP: "GBP",
  USD: "USD",
} as const;
export type Currency = (typeof CURRENCY)[keyof typeof CURRENCY];

/** Convert whole Naira to kobo (the unit everything is stored in). */
export function nairaToKobo(naira: number): number {
  return Math.round(naira * 100);
}

/** Convert kobo back to Naira for presentation only. */
export function koboToNaira(kobo: number): number {
  return kobo / 100;
}

/** Molar mass of glucose (g/mol) — the standard mmol/L <-> mg/dL conversion factor. */
export const GLUCOSE_MMOL_TO_MGDL = 18.0182;

/** Convert blood glucose from mg/dL to mmol/L (the unit vitals_readings stores). */
export function mgDlToMmolL(mgDl: number): number {
  return Math.round((mgDl / GLUCOSE_MMOL_TO_MGDL) * 100) / 100;
}

/** Convert blood glucose from mmol/L to mg/dL, for display in the patient's preferred unit. */
export function mmolLToMgDl(mmolL: number): number {
  return Math.round(mmolL * GLUCOSE_MMOL_TO_MGDL);
}

/** Whole-year age from a date_of_birth, or null if unknown. Used wherever a
 * rules engine needs age thresholds (risk tiers, screening/vaccination due
 * dates) — a single definition so they all agree on the same rough-but-
 * consistent calendar math. */
export function ageFromDateOfBirth(dateOfBirth: string | null): number | null {
  if (!dateOfBirth) return null;
  return Math.floor(
    (Date.now() - new Date(dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000)
  );
}

/** Nigerian E.164 phone number, e.g. +234XXXXXXXXXX. */
export const E164_NG = /^\+234\d{10}$/;

export function isValidNgPhone(value: string): boolean {
  return E164_NG.test(value);
}

/** profiles.role enum — derived from the generated DB types (FEATURE_SPEC §3.1). */
export type UserRole = Enums<"user_role">;

/** organisations.type enum. */
export type OrganisationType = Enums<"organisation_type">;

/** The five commercially-linked business categories. */
export const BUSINESS_CATEGORIES = [
  "chronic_disease",
  "preventative_medicine",
  "care_coordination",
  "b2b_institutional",
  "platform_infrastructure",
] as const;
export type BusinessCategory = (typeof BUSINESS_CATEGORIES)[number];

/** Screening result status — abnormal|critical drives the Cat 1 upgrade flow. */
export type ScreeningResultStatus = Enums<"result_status">;

/** Four-level clinical escalation ladder (clinician_alerts.level). */
export type EscalationLevel = Enums<"alert_level">;
