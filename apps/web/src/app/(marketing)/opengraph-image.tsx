import { SITE } from "@/lib/marketing/site";
import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "./_components/og-card";

// Default social share card for marketing pages that don't ship their own.
export const alt = `${SITE.name} — ${SITE.tagline}`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function OpengraphImage() {
  return renderOgImage({
    title: "Care that stays with you.",
    subtitle: "Health monitoring for chronic disease, prevention, and care coordination.",
  });
}
