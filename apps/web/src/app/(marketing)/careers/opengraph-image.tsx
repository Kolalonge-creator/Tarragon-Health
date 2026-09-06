import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "Careers at TarragonHealth";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "Careers at TarragonHealth",
    subtitle: "Help build the care that stays with people between doctor visits.",
  });
}
