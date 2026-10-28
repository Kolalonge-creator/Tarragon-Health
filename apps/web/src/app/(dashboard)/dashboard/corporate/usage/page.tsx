import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { callInstitution, notice } from "@/lib/institution/call";
import { nairaFromKobo, parseUsageStatements } from "@/lib/institution/files";

export const metadata = { title: "Usage statements" };
export const dynamic = "force-dynamic";

/** Monthly usage statements (24.4): what your sponsored services cost, by service, with no person named. Each is tied to your invoice once finance links it. */
export default async function UsagePage() {
  const res = await callInstitution("sponsor_usage_statements", {}, parseUsageStatements);
  if (res.state !== "ok") return <p role="status">{notice(res.state)}</p>;
  if (res.data.length === 0) return <p>Your first statement appears a few days after the month ends, once members have used a service you pay for.</p>;
  return (
    <div className="space-y-4">
      {res.data.map((s) => (
        <Card key={s.id}>
          <CardHeader>
            <CardTitle>
              {s.period.slice(0, 7)}: {nairaFromKobo(s.total_kobo)}
            </CardTitle>
            <CardDescription>
              {s.invoice ? `Invoice ${s.invoice.status}, ${nairaFromKobo(s.invoice.amount_kobo)}${s.invoice.due_at ? `, due ${s.invoice.due_at}` : ""}.` : "Not yet linked to an invoice."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th>Service</th>
                  <th>Uses</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {s.statement.lines.map((l) => (
                  <tr key={l.service_code}>
                    <td>{l.service_code.replace(/_/g, " ")}</td>
                    <td>{l.units}</td>
                    <td>{nairaFromKobo(l.amount_kobo)}</td>
                  </tr>
                ))}
                {s.statement.other_services_kobo > 0 && (
                  <tr>
                    <td>Other services (small groups combined)</td>
                    <td></td>
                    <td>{nairaFromKobo(s.statement.other_services_kobo)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
