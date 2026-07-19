/**
 * @tarragon/lifestyle-engine — public surface.
 *
 * The condition-agnostic Lifestyle Programme Engine (LPE). Conditions plug in as
 * pure-config adapters; all side-effects (DB, WhatsApp, ML) are injected.
 *
 * Spec: guideline/LIFESTYLE_ENGINE_SPEC.md
 * Build plan: docs/LIFESTYLE_ENGINE_BUILD_PLAN.md
 */
export * from "./types/index";
export * from "./core/index";
export * from "./agent/index";
export * from "./adapters/index";
export * from "./safety/index";
export * from "./measurements/index";
export * from "./messaging/index";
