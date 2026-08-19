import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "Terms of Service | TarragonHealth";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "Terms of Service",
    subtitle:
      "The terms that govern your use of TarragonHealth, including subscriptions, billing, and cancellation.",
  });
}
