import { fail, ok, type ProviderResult } from "./result.ts";

export type AppEnvironment = "production" | "staging" | "development" | "test";

/** Reads `APP_ENV`. Anything unrecognised is treated as production, so a typo can never switch a mock on. */
export function environmentFrom(value: string | undefined): AppEnvironment {
  return value === "staging" || value === "development" || value === "test" ? value : "production";
}

/**
 * Picks the provider for a runtime. A real, configured provider always wins. With none configured, a mock is allowed
 * outside production only: a mock that answers "paid" or "joined" in production would be a patient-facing lie about
 * money or care. In production a missing provider is a clear `not_configured`, never a silent mock.
 */
export function selectProvider<T extends { readonly isMock: boolean }>(args: {
  readonly environment: AppEnvironment;
  readonly real: T | null;
  readonly mock: () => T;
}): ProviderResult<T> {
  if (args.real) {
    return args.real.isMock && args.environment === "production" ? fail("not_configured", "A mock provider cannot run in production", false) : ok(args.real);
  }
  if (args.environment === "production") return fail("not_configured", "Provider is not configured", false);
  return ok(args.mock());
}
