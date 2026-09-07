import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PopulationForm } from "./population-form";

type PopulationRow = {
  id: string;
  name: string;
  description: string | null;
  kind: "registry" | "custom";
  is_system: boolean;
  status: "active" | "archived";
};

/**
 * Population Health Management Engine (spec §41) — every dynamic population
 * this organisation has defined: the five system registries seeded on
 * organisation creation (Hypertension, Diabetes, CKD, Pregnancy, Cancer
 * screening — spec §41.4), plus any custom segment staff have built (spec
 * §41.5). Membership is never stored here — it's computed live by
 * get_population_members() when a population is opened.
 */
export default async function PopulationsPage() {
  const profile = await getCurrentProfile();
  const supabase = await createClient();
  const { data } = await supabase
    .from("population_definitions")
    .select("id, name, description, kind, is_system, status")
    .eq("organisation_id", profile?.organisation_id ?? "")
    .order("is_system", { ascending: false })
    .order("name", { ascending: true });

  const populations = (data as PopulationRow[] | null) ?? [];
  const registries = populations.filter((p) => p.is_system);
  const custom = populations.filter((p) => !p.is_system);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Population health</h1>
        <p className="text-charcoal-ink/60">
          Define a population, see its risk profile and open care gaps, then intervene — a
          registry (always on) or a custom segment you build from any combination of condition,
          risk, care-gap, engagement, age, sex, and geography filters.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold text-charcoal-ink">Registries</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {registries.map((p) => (
            <PopulationCard key={p.id} population={p} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold text-charcoal-ink">Custom populations</h2>
        {custom.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">
            No custom populations yet — build one below (e.g. &ldquo;adults over 40, hypertension,
            no BP review in 6 months&rdquo;).
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {custom.map((p) => (
              <PopulationCard key={p.id} population={p} />
            ))}
          </div>
        )}
      </section>

      <PopulationForm />
    </div>
  );
}

function PopulationCard({ population }: { population: PopulationRow }) {
  return (
    <Link href={`/clinician/populations/${population.id}`}>
      <Card className="h-full transition hover:border-brand-green">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            {population.name}
            {population.status === "archived" && <Badge variant="grey">Archived</Badge>}
          </CardTitle>
          {population.description && <CardDescription>{population.description}</CardDescription>}
        </CardHeader>
        <CardContent>
          <Badge variant={population.is_system ? "blue" : "green"}>
            {population.is_system ? "Registry" : "Custom"}
          </Badge>
        </CardContent>
      </Card>
    </Link>
  );
}
