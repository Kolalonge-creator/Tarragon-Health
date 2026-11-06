import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MarketingIllustration } from "./illustrations/marketing-illustrations";
import { MARKETING_MEDIA } from "../_content/media";
import type { ServiceCard } from "../_content/services";

export function ServiceCardLink({
  service,
  headingLevel = "h3",
}: {
  service: ServiceCard;
  /** "h2" when the cards sit straight under the page h1 with no section heading between (services page). */
  headingLevel?: "h2" | "h3";
}) {
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
        <CardTitle as={headingLevel}>{service.title}</CardTitle>
        <CardDescription>{service.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {service.built ? (
          <span className="text-sm font-medium text-brand-green">Learn more <span aria-hidden>→</span></span>
        ) : (
          <span className="text-sm text-charcoal-ink/70">Coming soon</span>
        )}
      </CardContent>
    </Card>
  );

  if (!service.built) {
    // Only the picture fades: fading the whole card dropped its text below 4.5:1 contrast (WCAG 1.4.3).
    return <div className="[&_svg]:opacity-60">{inner}</div>;
  }

  return (
    // The ring lives on the Link itself: the Card is a descendant of the
    // focused element, so a focus-within ring on it would never match and
    // the keyboard indicator would vanish entirely.
    <Link
      href={service.href}
      className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2"
    >
      {inner}
    </Link>
  );
}
