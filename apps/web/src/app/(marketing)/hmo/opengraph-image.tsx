import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "HMO Support | TarragonHealth";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "HMO Support",
    subtitle:
      "Monitor member risk, close care gaps, and generate outcome evidence: chronic disease and preventive care for HMO members.",
  });
}
