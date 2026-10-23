import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "Pricing and accessibility | TarragonHealth";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "Pricing and accessibility",
    subtitle: "What is free, what costs money, and what the app does for large text, screen readers and audio.",
  });
}
