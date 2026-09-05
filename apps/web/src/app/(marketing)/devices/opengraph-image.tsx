import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "Devices that work with TarragonHealth";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "Devices, without the hard sell",
    subtitle: "Bring any device you already own, or none at all. Manual logging always works.",
  });
}
