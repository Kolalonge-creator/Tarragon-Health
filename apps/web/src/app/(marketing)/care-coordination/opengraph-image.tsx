import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "Care coordination | TarragonHealth";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "Care coordination",
    subtitle:
      "We work out which tests you need, write the request, and read every result. You pay the lab directly and we take nothing on it.",
  });
}
