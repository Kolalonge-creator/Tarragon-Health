import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "Annual Health Check | TarragonHealth";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "Annual Health Check",
    subtitle:
      "Your yearly tests at any laboratory you choose, uploaded to the app and reviewed by a doctor.",
  });
}
