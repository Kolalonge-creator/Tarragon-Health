import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function DashboardPlaceholder({
  greeting,
  roleLabel,
  comingUp,
  children,
}: {
  greeting: string;
  roleLabel: string;
  comingUp: string[];
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          {greeting}
        </h1>
        <p className="text-charcoal-ink/60">{roleLabel} dashboard</p>
      </div>
      {children}
      <Card>
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
    </div>
  );
}
