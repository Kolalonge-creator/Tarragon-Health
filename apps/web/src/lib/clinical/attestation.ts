export const ATTESTATION_VALID_DAYS = 365;

/**
 * Whether an annual attestation date is still current (§25). Kept in a lib fn
 * so Server Components don't call Date.now() directly in render
 * (react-hooks/purity).
 */
export function isAttestationCurrent(
  dateStr: string | null,
  validDays = ATTESTATION_VALID_DAYS,
): boolean {
  if (!dateStr) return false;
  const days = (Date.now() - new Date(dateStr).getTime()) / 86_400_000;
  return days <= validDays;
}
