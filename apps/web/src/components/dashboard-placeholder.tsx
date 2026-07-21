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
      <div className="flex items-center gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-soft-sage">
          <Icon className="h-6 w-6 text-deep-forest" strokeWidth={2} />
        </span>
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">
            {greeting}
          </h1>
          <p className="text-sm text-charcoal-ink/60">{roleLabel} dashboard</p>
        </div>
      </div>
      {children}
      {comingUp.length > 0 && (
        <Card variant="soft">
          <CardHeader>
            <CardTitle>On the roadmap</CardTitle>
            <CardDescription>Planned for an upcoming release.</CardDescription>
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
