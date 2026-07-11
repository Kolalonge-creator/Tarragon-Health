import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MarketingIllustration } from "./illustrations/marketing-illustrations";
import { MARKETING_MEDIA } from "../_content/media";
import type { ServiceCard } from "../_content/services";

export function ServiceCardLink({ service }: { service: ServiceCard }) {
  const media =
    service.key in MARKETING_MEDIA.serviceCard
      ? MARKETING_MEDIA.serviceCard[service.key as keyof typeof MARKETING_MEDIA.serviceCard]
      : undefined;

  const inner = (
    <Card
      variant="soft"
      className="h-full overflow-hidden transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-brand-green focus-within:ring-offset-2"
    >
      {media?.illustration ? (
        <div className="border-b border-charcoal-ink/8 bg-soft-sage/50 px-2 pt-2">
          <MarketingIllustration
            id={media.illustration}
            className="aspect-[16/10] w-full rounded-t-xl"
          />
        </div>
      ) : null}
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
