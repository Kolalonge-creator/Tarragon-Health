import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "Where we work: coverage by state | TarragonHealth";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "Where we work",
    subtitle:
      "Check which TarragonHealth services are live in any Nigerian state before you sign up.",
  });
}
