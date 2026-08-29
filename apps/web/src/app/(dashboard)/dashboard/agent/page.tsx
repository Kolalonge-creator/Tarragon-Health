import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { listMyCommissions } from "@/lib/queries/agents";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function kobo(n: number) {
  return `₦${(n / 100).toLocaleString()}`;
}

const SOURCE_LABEL: Record<string, string> = {
  care_voucher_redeemed: "Health check redeemed",
  video_visit_completed: "Video consult completed",
  screening_event_registration: "Screening event registration",
};

export default async function AgentDashboardPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "agent") redirect("/patient");

  const { agent, commissions } = await listMyCommissions();

  if (!agent) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-charcoal-ink/70">
          Your agent record isn&apos;t set up yet — check with your Tarragon contact.
        </CardContent>
      </Card>
    );
  }

  const totals = commissions.reduce(
    (acc, c) => {
      if (c.status === "pending") acc.pending += c.amount_kobo;
      else if (c.status === "approved") acc.approved += c.amount_kobo;
      else if (c.status === "paid") acc.paid += c.amount_kobo;
      return acc;
    },
    { pending: 0, approved: 0, paid: 0 }
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-charcoal-ink">Your sales</h1>
        <p className="text-sm text-charcoal-ink/70">
          Agent code <span className="font-mono">{agent.agent_code}</span> — share it so a sale is credited to
          you.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-charcoal-ink/70">Pending</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{kobo(totals.pending)}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-charcoal-ink/70">In this week&apos;s batch</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{kobo(totals.approved)}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-charcoal-ink/70">Paid out</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{kobo(totals.paid)}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Commission history</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-charcoal-ink/60">
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">What</th>
                <th className="py-2 pr-4">Amount</th>
                <th className="py-2 pr-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {commissions.map((c) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="py-2 pr-4">{new Date(c.earned_at).toLocaleDateString()}</td>
                  <td className="py-2 pr-4">{SOURCE_LABEL[c.source_type] ?? c.source_type}</td>
                  <td className="py-2 pr-4">{kobo(c.amount_kobo)}</td>
                  <td className="py-2 pr-4">
                    <Badge variant={c.status === "paid" ? "green" : c.status === "voided" ? "grey" : "amber"}>
                      {c.status}
                    </Badge>
                  </td>
                </tr>
              ))}
              {commissions.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-charcoal-ink/60">
                    No sales yet — every completed check, consult or screening-event registration you refer
                    will show up here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
