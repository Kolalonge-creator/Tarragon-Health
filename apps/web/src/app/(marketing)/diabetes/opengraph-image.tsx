import { SERVICE_CARDS } from "../_content/services";
import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from "../_components/og-card";

const card = SERVICE_CARDS.find((c) => c.key === "diabetes");

export const alt = card ? `${card.title} | TarragonHealth` : "TarragonHealth";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgImage({
    title: card?.title ?? "TarragonHealth",
    subtitle: card?.description ?? "",
  });
}
