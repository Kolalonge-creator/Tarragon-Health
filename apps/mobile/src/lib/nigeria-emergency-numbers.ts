/**
 * Mirrors apps/web/src/lib/nigeria-emergency-numbers.ts — bundled in the
 * binary (not fetched) so it renders with zero signal. Getting one of these
 * wrong is a real-harm scenario, so keep this list exactly in lock-step with
 * the web source; only add a state override after independently verifying
 * the number against an official .gov/agency source, per that file's own
 * comment.
 */
export type EmergencyNumber = { label: string; number: string; tel: string };

const NATIONAL: EmergencyNumber[] = [{ label: "National Emergency Line", number: "112", tel: "112" }];

const STATE_OVERRIDES: Record<string, EmergencyNumber[]> = {
  Lagos: [
    { label: "National Emergency Line", number: "112", tel: "112" },
    { label: "Lagos State Emergency (toll-free)", number: "767", tel: "767" },
    { label: "LASEMS / LASAMBUS Ambulance", number: "123", tel: "123" },
  ],
};

/** Every state resolves to at least the national line — never empty. */
export function getEmergencyNumbers(state: string | null | undefined): EmergencyNumber[] {
  if (state && STATE_OVERRIDES[state]) return STATE_OVERRIDES[state];
  return NATIONAL;
}
