import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "Privacy & Data Processing Consent | TarragonHealth";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "Privacy & Data Processing Consent",
    subtitle:
      "How TarragonHealth collects, uses, and protects your health information under Nigerian data protection law.",
  });
}
