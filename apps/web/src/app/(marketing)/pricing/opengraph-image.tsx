import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "TarragonHealth pricing: simple and transparent";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "Simple, transparent pricing",
    subtitle: "The app is free. Membership is one price for a year, with no hidden costs.",
  });
}
