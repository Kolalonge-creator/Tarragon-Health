import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { callInstitution, notice } from "@/lib/institution/call";
import { nairaFromKobo } from "@/lib/institution/files";
import { ConfigForm } from "./config-form";

export const metadata = { title: "Programme configuration" };
export const dynamic = "force-dynamic";

const schema = z.object({
  allowed_pathways: z.array(z.string()),
  rewards_budget_max_kobo: z.number(),
  items: z.array(z.object({ code: z.string(), kind: z.string() })),
  programmes: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.string(),
      item_codes: z.array(z.string()),
      share_percent: z.number(),
      budget_kobo: z.number(),
      budget_left_kobo: z.number(),
      valid_from: z.string(),
      valid_to: z.string(),
    }),
  ),
  campaigns: z.array(z.object({ id: z.string(), name: z.string(), status: z.string(), kind: z.string() })),
  requests: z.array(
    z.object({
      id: z.string(),
      version: z.number(),
      status: z.string(),
      pathways: z.array(z.string()),
      item_codes: z.array(z.string()),
      rewards_budget_kobo: z.number(),
      submitted_at: z.string(),
      review_note: z.string().nullable(),
    }),
  ),
});

/** One screen for what your programme covers (24.2). It shows what already exists and sends a request; Tarragon reviews and sets it up. */
export default async function ProgrammeConfigurationPage() {
  const res = await callInstitution("institution_config_current", {}, (d) => {
    const r = schema.safeParse(d);
    return r.success ? r.data : null;
  });
  if (res.state !== "ok") return <p role="status">{notice(res.state)}</p>;
  const c = res.data;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>What is set up now</CardTitle>
          <CardDescription>Programmes Tarragon has set up for you, with the money you set aside for each. You see amounts and counts for your group, never a person.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {c.programmes.length === 0 ? (
            <p>No sponsored programme yet.</p>
          ) : (
            c.programmes.map((p) => (
              <section key={p.id} className="rounded border p-3">
                <h3 className="font-medium">
                  {p.name} <span className="text-charcoal-ink/50">({p.status})</span>
                </h3>
                <p>
                  You pay {p.share_percent}% of: {p.item_codes.join(", ")}. Open {p.valid_from} to {p.valid_to}.
                </p>
                <p>
                  Budget {nairaFromKobo(p.budget_kobo)}; left {nairaFromKobo(p.budget_left_kobo)}.
                </p>
              </section>
            ))
          )}
          {c.campaigns.length > 0 && <p>Campaigns and challenges: {c.campaigns.map((x) => `${x.name} (${x.status})`).join(", ")}.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Ask for a change</CardTitle>
          <CardDescription>Choose what you want. Tarragon reviews every request before anything changes for your members.</CardDescription>
        </CardHeader>
        <CardContent>
          <ConfigForm pathways={c.allowed_pathways} items={c.items} campaigns={c.campaigns} maxBudgetNaira={Math.floor(c.rewards_budget_max_kobo / 100)} />
        </CardContent>
      </Card>
      {c.requests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Your requests</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {c.requests.map((r) => (
              <p key={r.id}>
                Version {r.version}, {r.status}. {r.pathways.join(", ") || "no pathways"}; {r.item_codes.length} services; rewards request {nairaFromKobo(r.rewards_budget_kobo)}.
                {r.review_note ? ` Tarragon said: ${r.review_note}` : ""}
              </p>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
