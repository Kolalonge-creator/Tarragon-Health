import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "Services | TarragonHealth";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "Services",
    subtitle:
      "Everything TarragonHealth helps you manage: chronic disease, preventive health, medication, labs, and care coordination, in one connected record.",
  });
}
