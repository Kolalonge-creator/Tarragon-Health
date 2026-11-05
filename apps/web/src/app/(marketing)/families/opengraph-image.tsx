import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "TarragonHealth for families";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "For families",
    subtitle: "Support a parent in Nigeria from anywhere, with their consent.",
  });
}
