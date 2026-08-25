import type { ReactNode } from "react";
import type { MarketingMediaSlot } from "../_content/media";
import { MarketingMediaFrame } from "./marketing-media-frame";
import { cn } from "@/lib/utils";

export function MarketingHero({
  media,
  visual,
  children,
  className,
}: {
  media: MarketingMediaSlot;
  /** Overrides the default illustration frame with a custom hero visual (e.g. a product mockup). */
  visual?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid items-center gap-12 lg:grid-cols-2 lg:gap-16", className)}>
      <div className="text-center lg:text-left">{children}</div>
      <div className="relative mx-auto w-full max-w-md lg:max-w-none">
        {visual ?? <MarketingMediaFrame media={media} priority className="marketing-hero-float" />}
      </div>
    </div>
  );
}
