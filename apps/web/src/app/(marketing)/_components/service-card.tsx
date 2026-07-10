import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ServiceCard } from "../_content/services";

export function ServiceCardLink({ service }: { service: ServiceCard }) {
  const inner = (
    <Card
      variant="soft"
      className="h-full transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-brand-green focus-within:ring-offset-2"
    >
      <CardHeader>
        <CardTitle>{service.title}</CardTitle>
        <CardDescription>{service.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {service.built ? (
          <span className="text-sm font-medium text-brand-green">Learn more →</span>
        ) : (
          <span className="text-sm text-charcoal-ink/40">Coming soon</span>
        )}
      </CardContent>
    </Card>
  );

  if (!service.built) {
    return <div className="opacity-60">{inner}</div>;
  }

  return (
    <Link href={service.href} className="block rounded-xl focus-visible:outline-none">
      {inner}
    </Link>
  );
}
