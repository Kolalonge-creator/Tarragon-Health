import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../../_components/og-card";

export const alt = "How pricing works | TarragonHealth";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "How pricing works",
    subtitle:
      "Our No-Hidden-Cost Promise, why there is nothing to trial, giving Membership, how Tarragon compares to your HMO, and booking step-by-step.",
  });
}
