import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "FAQ | TarragonHealth";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "Frequently asked questions",
    subtitle:
      "Clear answers about how TarragonHealth works, what's included, and how care and escalation happen.",
  });
}
