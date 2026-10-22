/**
 * Integer kobo as "NGN 1,234.50". The PDF's built-in font has no naira sign, and integer arithmetic keeps kobo exact (INV-15). A negative
 * amount (a correction taking money back) keeps its minus sign.
 */
export function pdfNaira(kobo: number): string {
  const sign = kobo < 0 ? "-" : "";
  const abs = Math.abs(kobo);
  const whole = Math.trunc(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}NGN ${whole.toLocaleString("en-GB")}.${frac}`;
}
