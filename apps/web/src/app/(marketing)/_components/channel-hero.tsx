"use client";

import { useSearchParams } from "next/navigation";
import { PhotoBannerHero } from "./marketing-photo-banner-hero";
import { getChannelHero } from "../_content/channel-heroes";

/**
 * The homepage hero, with its `?channel=` re-skin resolved on the CLIENT.
 *
 * It used to be resolved on the server from `searchParams`, which is a
 * dynamic API: awaiting it opted the whole homepage out of static rendering,
 * so every visitor got a fresh server render of a page whose only
 * request-dependent pixel is this hero's copy. docs/MARKETING_SITE_SPEC.md §4
 * requires marketing pages to be static/ISR, so the channel read moved here.
 *
 * `useSearchParams` suspends during prerender, so the caller wraps this in a
 * <Suspense> whose fallback renders the DEFAULT hero — the same markup the
 * vast majority of visitors (no `?channel=`) end up with after hydration, so
 * there is no visible swap for them. A visitor arriving on a channel link
 * sees the default hero for one frame before their copy lands, which is the
 * cost of keeping the page in the CDN cache for everyone else.
 */
export function ChannelHero({
  imageSrc,
  imageAlt,
  imagePosition,
}: {
  imageSrc: string;
  imageAlt: string;
  imagePosition?: string;
}) {
  const searchParams = useSearchParams();
  const hero = getChannelHero(searchParams.get("channel") ?? undefined);

  return (
    <PhotoBannerHero
      eyebrow={hero.eyebrow}
      title={hero.title}
      description={hero.description}
      primaryHref={hero.primaryHref}
      primaryLabel={hero.primaryLabel}
      secondaryHref={hero.secondaryHref}
      secondaryLabel={hero.secondaryLabel}
      imageSrc={imageSrc}
      imageAlt={imageAlt}
      imagePosition={imagePosition}
    />
  );
}
