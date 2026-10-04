/** The address the QR on a prescription points at. The token is the whole credential: never log it or put it in a notification. */
export function prescriptionVerifyUrl(publicToken: string): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://tarragonhealth.ng").replace(/\/+$/, "");
  return `${base}/verify-rx/${publicToken}`;
}
