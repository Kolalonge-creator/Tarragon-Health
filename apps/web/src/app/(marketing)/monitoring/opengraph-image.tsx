import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "TarragonHealth: Continuous monitoring";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "Continuous monitoring",
    subtitle: "Every reading you log is checked against care protocols, so a dangerous one reaches a doctor.",
  });
}
