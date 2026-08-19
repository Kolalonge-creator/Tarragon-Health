import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "Telehealth Consent | TarragonHealth";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "Telehealth Consent",
    subtitle:
      "Your consent to receive remote clinical review and monitoring from TarragonHealth's doctors.",
  });
}
