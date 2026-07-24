"use client";

import {
  useHealthEducationCatalogue,
  useSetContentActive,
  useSetContentDripWeek,
  type HealthEducationContent,
} from "@/lib/queries/health-education";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";

const CONDITION_LABEL: Record<string, string> = {
  hypertension: "Blood pressure",
  diabetes: "Diabetes",
  obesity: "Weight",
  ckd: "Kidney health",
  cardiovascular: "Heart health",
  other: "General",
};

function conditionLabel(condition: HealthEducationContent["condition"]): string {
  if (!condition) return "Everyone";
  return CONDITION_LABEL[condition] ?? condition;
}

export function HealthEducationManager() {
  const { data: content, isLoading, isError } = useHealthEducationCatalogue();
  const setActive = useSetContentActive();
  const setDripWeek = useSetContentDripWeek();

  const liveCount = content?.filter((c) => c.is_active).length ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Articles &amp; videos</CardTitle>
        <CardDescription>
          {liveCount} of {content?.length ?? 0} items live. Hiding an item removes it from every
          patient&apos;s feed immediately; their saved progress is kept.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load the library.</p>}
        {setActive.isError && (
          <p className="text-sm text-red-600">Could not update that item — please try again.</p>
        )}
        {content && content.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {content.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-charcoal-ink">{item.title}</p>
                  <p className="text-xs text-charcoal-ink/60">
                    {conditionLabel(item.condition)}
                    {item.min_risk_level ? ` · risk ${item.min_risk_level}+` : ""}
                    {` · ${item.content_type}`}
                    {item.clinician_reviewed ? " · clinician-reviewed" : " · not reviewed"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    aria-label={`Curriculum week for ${item.title}`}
                    className="h-8 w-28 text-xs"
                    value={item.drip_week === null ? "" : String(item.drip_week)}
                    onChange={(e) =>
                      setDripWeek.mutate({
                        id: item.id,
                        dripWeek: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  >
                    <option value="">Always on</option>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((week) => (
                      <option key={week} value={week}>
                        Week {week}
                      </option>
                    ))}
                  </Select>
                  <Badge variant={item.is_active ? "green" : "grey"}>
                    {item.is_active ? "Live" : "Hidden"}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={setActive.isPending}
                    onClick={() => setActive.mutate({ id: item.id, isActive: !item.is_active })}
                  >
                    {item.is_active ? "Hide" : "Publish"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
