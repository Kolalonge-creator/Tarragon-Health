import type { ReactNode } from "react";
import type { MarketingMediaSlot } from "../_content/media";
import { MarketingMediaFrame } from "./marketing-media-frame";
import { cn } from "@/lib/utils";

export function MarketingHero({
  media,
  children,
  className,
}: {
  media: MarketingMediaSlot;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid items-center gap-12 lg:grid-cols-2 lg:gap-16", className)}>
      <div className="text-center lg:text-left">{children}</div>
      <div className="relative mx-auto w-full max-w-xl lg:max-w-none">
        <MarketingMediaFrame media={media} priority className="marketing-hero-float" />
        <div
          className="pointer-events-none absolute -bottom-6 -left-6 hidden h-24 w-24 rounded-full bg-brand-green/10 blur-2xl lg:block"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -right-4 -top-4 hidden h-20 w-20 rounded-full bg-sprout-gold/15 blur-2xl lg:block"
          aria-hidden
        />
      </div>
    </div>
  );
}
