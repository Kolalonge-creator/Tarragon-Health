import Image from "next/image";
import type { MarketingMediaSlot } from "../_content/media";
import { MarketingIllustration } from "./illustrations/marketing-illustrations";
import { cn } from "@/lib/utils";

export function MarketingMediaFrame({
  media,
  className,
  priority = false,
  sizes = "(min-width: 1024px) 540px, 100vw",
}: {
  media: MarketingMediaSlot;
  className?: string;
  priority?: boolean;
  sizes?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-3xl border border-charcoal-ink/10 bg-white shadow-xl shadow-charcoal-ink/8",
        "motion-safe:opacity-0 motion-safe:[animation:marketing-fade-in_0.9s_ease-out_forwards]",
        className
      )}
    >
      {media.imageSrc ? (
        <Image
          src={media.imageSrc}
          alt={media.imageAlt ?? ""}
          width={960}
          height={720}
          className="h-auto w-full object-cover"
          priority={priority}
          sizes={sizes}
        />
      ) : media.illustration ? (
        <MarketingIllustration id={media.illustration} className="aspect-[4/3] w-full" />
      ) : null}
    </div>
  );
}
