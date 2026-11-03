import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "Annual Health Check | TarragonHealth";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "Annual Health Check",
    subtitle:
      "Eighteen blood tests once a year, done by Tarragon's own laboratory team and read with your care team. Included in Membership Plus.",
  });
}
