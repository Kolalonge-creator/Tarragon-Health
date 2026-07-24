import { ImageResponse } from "next/og";
import { SITE } from "@/lib/marketing/site";

/**
 * Shared renderer for every marketing OpenGraph card, so each page can ship a
 * tailored 1200x630 share image (title + subtitle) over one consistent brand
 * treatment. Drawn entirely in-code; no external asset or font fetch.
 */

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

const BRAND_GREEN = "#0E7C52";
const DEEP_FOREST = "#0A5C3D";
const IVORY = "#FBF7F0";
const GOLD = "#E8B33D";

export function renderOgImage({
  title,
  subtitle,
  footer = "For Nigerians",
}: {
  title: string;
  subtitle: string;
  footer?: string;
}) {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "80px",
          background: `linear-gradient(135deg, ${DEEP_FOREST} 0%, ${BRAND_GREEN} 100%)`,
          color: IVORY,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "56px",
              height: "56px",
              borderRadius: "16px",
              background: "rgba(251,247,240,0.15)",
              color: GOLD,
              fontSize: "34px",
              fontWeight: 700,
            }}
          >
            T
          </div>
          <div style={{ fontSize: "34px", fontWeight: 700, letterSpacing: "-0.5px" }}>
            {SITE.name}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <div
            style={{
              fontSize: title.length > 34 ? "62px" : "76px",
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: "-2px",
              maxWidth: "980px",
            }}
          >
            {title}
          </div>
          <div style={{ fontSize: "32px", color: "rgba(251,247,240,0.85)", maxWidth: "920px", lineHeight: 1.3 }}>
            {subtitle}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            fontSize: "26px",
            color: "rgba(251,247,240,0.75)",
          }}
        >
          <div style={{ width: "48px", height: "4px", borderRadius: "2px", background: GOLD }} />
          {footer}
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
