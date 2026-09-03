"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { ResourceArticle } from "../_content/resources";
import { ResourceThumbnail, resourceThumbnailIcon } from "./resource-thumbnail";

/**
 * A horizontally-scrolling "explore more" strip of resource-article cards
 * with arrow + dot controls. Used both as a related-articles carousel at the
 * foot of each /resources/[slug] article (scoped to that article's own
 * category) and on condition pages like /diabetes (scoped to that
 * condition's full article set). Renders nothing when there is nothing to
 * show, so a thin category never leaves an empty shell on the page.
 */
export function ResourceCarousel({
  title,
  articles,
}: {
  title: string;
  articles: ResourceArticle[];
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const scrollToIndex = useCallback((index: number) => {
    const track = trackRef.current;
    const card = track?.children[index] as HTMLElement | undefined;
    if (!track || !card) return;
    track.scrollTo({ left: card.offsetLeft - track.offsetLeft, behavior: "smooth" });
    setActiveIndex(index);
  }, []);

  const handleScroll = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const cards = Array.from(track.children) as HTMLElement[];
    let closest = 0;
    let closestDistance = Infinity;
    cards.forEach((card, index) => {
      const distance = Math.abs(card.offsetLeft - track.offsetLeft - track.scrollLeft);
      if (distance < closestDistance) {
        closestDistance = distance;
        closest = index;
      }
    });
    setActiveIndex(closest);
  }, []);

  if (articles.length === 0) return null;

  return (
    <div>
      <h2 className="text-center font-heading text-2xl font-bold text-charcoal-ink sm:text-3xl">
        {title}
      </h2>
      <div
        ref={trackRef}
        onScroll={handleScroll}
        className="mt-8 flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-smooth pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {articles.map((article) => (
          <Link
            key={article.slug}
            href={`/resources/${article.slug}`}
            className="group w-64 shrink-0 snap-start overflow-hidden rounded-2xl border border-charcoal-ink/10 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-brand-green/40 hover:shadow-md sm:w-72"
          >
            <ResourceThumbnail
              category={article.category}
              icon={resourceThumbnailIcon(article)}
              className="rounded-t-2xl"
            />
            <div className="p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-deep-forest">
                {article.category} <span aria-hidden>·</span> Article
              </p>
              <h3 className="mt-2 font-heading text-base font-semibold leading-snug text-charcoal-ink group-hover:text-brand-green">
                {article.title}
              </h3>
            </div>
          </Link>
        ))}
      </div>
      {articles.length > 1 ? (
        <div className="mt-6 flex items-center justify-center gap-6">
          <CarouselArrowButton
            direction="left"
            disabled={activeIndex === 0}
            onClick={() => scrollToIndex(Math.max(0, activeIndex - 1))}
          />
          <div className="flex items-center gap-2">
            {articles.map((article, index) => (
              <button
                key={article.slug}
                type="button"
                aria-label={`Go to "${article.title}"`}
                aria-current={index === activeIndex}
                onClick={() => scrollToIndex(index)}
                className={cn(
                  "h-2.5 w-2.5 rounded-full transition",
                  index === activeIndex ? "bg-clinical-navy" : "bg-charcoal-ink/15"
                )}
              />
            ))}
          </div>
          <CarouselArrowButton
            direction="right"
            disabled={activeIndex === articles.length - 1}
            onClick={() => scrollToIndex(Math.min(articles.length - 1, activeIndex + 1))}
          />
        </div>
      ) : null}
    </div>
  );
}

function CarouselArrowButton({
  direction,
  disabled,
  onClick,
}: {
  direction: "left" | "right";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={direction === "left" ? "Previous resource" : "Next resource"}
      disabled={disabled}
      onClick={onClick}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-charcoal-ink/15 bg-white text-charcoal-ink shadow-sm transition hover:border-brand-green/40 hover:text-brand-green disabled:cursor-not-allowed disabled:opacity-30"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
        <path
          d={direction === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"}
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
