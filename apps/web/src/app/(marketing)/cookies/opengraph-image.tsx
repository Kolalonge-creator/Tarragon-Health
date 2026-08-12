import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

export const alt = "Cookie Policy | TarragonHealth";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: "Cookie Policy",
    subtitle: "What cookies, local storage, and analytics TarragonHealth uses, and why.",
  });
}
