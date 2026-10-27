import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { callInstitution } from "@/lib/institution/call";
import { describeLedgerEntry, parsePrivacyLedger } from "@/lib/institution/files";

/**
 * Which tiles were withheld and why (S79, 24.3), and the procurement pack download (24.6). Renders nothing while the console switch is off, so the
 * existing reports page is unchanged until Tarragon turns it on. The ledger carries reason words only, never a count below the minimum.
 */
export async function PrivacyLedgerCard() {
  const res = await callInstitution("sponsor_privacy_ledger", {}, parsePrivacyLedger);
  if (res.state !== "ok") return null;
  const { entries, minimum_cell } = res.data;
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Procurement and renewal pack</CardTitle>
          <CardDescription>
            One file for your finance or procurement team: group figures, contract terms, monthly usage, what was withheld, and how to read it. Every download is recorded.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <form method="post" action="/dashboard/corporate/reports/procurement-pack?format=pdf">
            <button type="submit" className="min-h-11 rounded border px-4">Download as PDF</button>
          </form>
          <form method="post" action="/dashboard/corporate/reports/procurement-pack?format=csv">
            <button type="submit" className="min-h-11 rounded border px-4">Download as spreadsheet (CSV)</button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>What we held back, and why</CardTitle>
          <CardDescription>
            Some figures are not shown so that no one can be picked out of a small group. This list tells you which, so a missing figure is never a mystery.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-sm">Nothing has been held back.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {entries.map((e, i) => (
                <li key={`${e.period}-${e.programme}-${e.tile}-${i}`}>
                  <strong>{e.period.slice(0, 7)}, {e.programme}.</strong> {describeLedgerEntry(e, minimum_cell)}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
