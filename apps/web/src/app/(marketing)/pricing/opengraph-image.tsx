import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "TarragonHealth pricing — simple, transparent plans";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "Simple, transparent pricing",
    subtitle: "Clear plans with no hidden costs. Every line item carries exactly one label.",
  });
}
