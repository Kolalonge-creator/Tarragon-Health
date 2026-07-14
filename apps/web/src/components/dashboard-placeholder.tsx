import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";

export function DashboardPlaceholder({
  greeting,
  roleLabel,
  comingUp,
  icon: Icon = SEMANTIC_ICON.preventive,
  children,
}: {
  greeting: string;
  roleLabel: string;
  comingUp: string[];
  icon?: LucideIcon;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Icon className="h-6 w-6 text-deep-forest" strokeWidth={2} />
        <div>
          <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
            {greeting}
          </h1>
          <p className="text-charcoal-ink/60">{roleLabel} dashboard</p>
        </div>
      </div>
      {children}
      {comingUp.length > 0 && (
        <Card variant="soft">
          <CardHeader>
            <CardTitle>Coming in Sprint 2</CardTitle>
            <CardDescription>
              This shell confirms auth + role routing are wired up. Real data lands next.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="list-inside list-disc space-y-1.5 text-sm text-charcoal-ink/80">
              {comingUp.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
