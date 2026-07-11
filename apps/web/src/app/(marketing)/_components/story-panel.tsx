import type { ReactNode } from "react";
import type { MarketingMediaSlot } from "../_content/media";
import { MarketingMediaFrame } from "./marketing-media-frame";
import { cn } from "@/lib/utils";

export function StoryPanel({
  eyebrow,
  title,
  description,
  media,
  reverse = false,
  invertText = false,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  media: MarketingMediaSlot;
  reverse?: boolean;
  invertText?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid items-center gap-10 lg:grid-cols-2 lg:gap-14",
        reverse && "lg:[&>*:first-child]:order-2"
      )}
    >
      <div>
        {eyebrow ? (
          <p
            className={cn(
              "text-sm font-medium uppercase tracking-wide",
              invertText ? "text-white/60" : "text-brand-green"
            )}
          >
            {eyebrow}
          </p>
        ) : null}
        <h2
          className={cn(
            "mt-2 font-heading text-3xl font-semibold sm:text-4xl",
            invertText ? "text-white" : "text-charcoal-ink"
          )}
        >
          {title}
        </h2>
        {description ? (
          <p
            className={cn(
              "mt-4 text-lg leading-relaxed",
              invertText ? "text-white/70" : "text-charcoal-ink/70"
            )}
          >
            {description}
          </p>
        ) : null}
        {children}
      </div>
      <MarketingMediaFrame media={media} />
    </div>
  );
}
