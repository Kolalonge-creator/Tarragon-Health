import { connection } from "next/server";
import { headers } from "next/headers";

/**
 * TEMPORARY diagnostic (2026-11-06), remove once read. The nonce policy reaches the browser but its scripts carry no nonce on
 * Vercel (a local production build stamps every one). This page shows only yes/no for which forwarded request headers reached the
 * renderer. No value, no person, nothing from the session.
 */
export const metadata = { robots: { index: false, follow: false } };

export default async function CspProbePage() {
  await connection();
  const h = await headers();
  const csp = h.get("content-security-policy");
  const rows: [string, boolean][] = [
    ["control header (x-csp-probe) forwarded", h.get("x-csp-probe") === "1"],
    ["content-security-policy request header present", csp !== null],
    ["it carries a nonce", typeof csp === "string" && csp.includes("'nonce-")],
    ["content-security-policy-report-only request header present", h.get("content-security-policy-report-only") !== null],
  ];
  return (
    <main style={{ padding: 24, fontFamily: "monospace" }}>
      {rows.map(([label, ok]) => (
        <p key={label}>
          {label}: {ok ? "yes" : "no"}
        </p>
      ))}
    </main>
  );
}
