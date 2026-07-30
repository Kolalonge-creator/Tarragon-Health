import { cn } from "@/lib/utils";
import type { ResourceArticle } from "../_content/resources";

/**
 * Small brand-styled line icons standing in for photography on resource
 * cards (docs/BRAND_GUIDE.md §8 — illustration until a real photo exists,
 * same convention as MarketingIllustration). Derived at render time from the
 * article's slug/category rather than stored on the row, so it works
 * identically for the static seed list and any admin-published DB article
 * (marketing_resources has no thumbnail column, and doesn't need one).
 */
export type ResourceThumbnailIconId =
  | "glucose"
  | "alert-signs"
  | "first-steps"
  | "nutrition"
  | "myth-check"
  | "mental-health"
  | "routine"
  | "heart-pulse"
  | "footsteps"
  | "scale-tape"
  | "clipboard-check"
  | "lab-drop"
  | "reversible-arrow"
  | "pill-classes"
  | "insulin-pen"
  | "foot-shield"
  | "organs"
  | "hands-heart"
  | "salt-shaker"
  | "oil-drop"
  | "artery"
  | "ribbon"
  | "magnifier-check"
  | "results-envelope"
  | "smoke-off";

const CATEGORY_DEFAULT_ICON: Record<ResourceArticle["category"], ResourceThumbnailIconId> = {
  "Blood pressure": "heart-pulse",
  Diabetes: "glucose",
  Weight: "scale-tape",
  Screening: "clipboard-check",
  Cholesterol: "lab-drop",
  Nutrition: "nutrition",
};

const SLUG_ICON: Partial<Record<string, ResourceThumbnailIconId>> = {
  "normal-blood-pressure": "heart-pulse",
  "hba1c-explained": "glucose",
  "lower-blood-pressure-naturally": "footsteps",
  "diabetes-early-signs": "alert-signs",
  "diabetes-just-diagnosed": "first-steps",
  "diabetes-diet-nigerian-kitchen": "nutrition",
  "diabetes-non-medical-treatments-do-they-work": "myth-check",
  "diabetes-and-mental-health": "mental-health",
  "diabetes-day-to-day-management": "routine",
  "weight-bmi-waist": "scale-tape",
  "weight-loss-medication-questions-for-your-doctor": "pill-classes",
  "finding-healthy-food-on-any-budget": "nutrition",
  "managing-triggers-that-lead-to-overeating": "mental-health",
  "annual-health-check-guide": "clipboard-check",
  "cholesterol-explained": "lab-drop",
  "statins-myths-explained": "myth-check",
  "home-blood-pressure-monitoring": "heart-pulse",
  "blood-pressure-medication-myths": "myth-check",
  "why-crash-diets-dont-work": "myth-check",
  "exercise-for-weight-loss-how-much": "footsteps",
  "cancer-screening-by-age": "clipboard-check",
  "hiv-hepatitis-screening-why-test": "lab-drop",
  "adult-vaccines-you-might-be-missing": "foot-shield",
  "blood-group-genotype-explained": "lab-drop",
  "prediabetes-the-reversible-warning-stage": "reversible-arrow",
  "diabetes-medications-explained": "pill-classes",
  "starting-insulin-what-to-expect": "insulin-pen",
  "diabetic-foot-care-daily-habit": "foot-shield",
  "diabetes-complications-eyes-kidneys-nerves-heart": "organs",
  "diabetes-and-sexual-health": "hands-heart",
  "diabetes-myths-that-need-to-die": "myth-check",
  "blood-pressure-medications-explained": "pill-classes",
  "cooking-with-less-salt-nigerian-kitchen": "salt-shaker",
  "hypertension-complications-heart-brain-kidneys": "organs",
  "cholesterol-and-heart-disease-connection": "artery",
  "cooking-oils-trans-fats-cholesterol": "oil-drop",
  "cancer-warning-signs-worth-not-ignoring": "magnifier-check",
  "what-actually-reduces-cancer-risk": "ribbon",
  "abnormal-screening-result-what-happens-next": "results-envelope",
  "quitting-smoking-cancer-risk": "smoke-off",
};

export function resourceThumbnailIcon(article: {
  slug: string;
  category: ResourceArticle["category"];
}): ResourceThumbnailIconId {
  return SLUG_ICON[article.slug] ?? CATEGORY_DEFAULT_ICON[article.category];
}

export function ResourceThumbnail({
  icon,
  className,
}: {
  icon: ResourceThumbnailIconId;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-soft-sage",
        className
      )}
    >
      <div
        aria-hidden
        className="absolute -right-6 -top-8 h-28 w-28 rounded-full bg-brand-green/10"
      />
      <div
        aria-hidden
        className="absolute -bottom-10 -left-8 h-32 w-32 rounded-full bg-clinical-navy/10"
      />
      <svg
        viewBox="0 0 24 24"
        className="relative h-10 w-10 text-brand-green"
        fill="none"
        aria-hidden
      >
        <ResourceIconPath id={icon} />
      </svg>
    </div>
  );
}

function ResourceIconPath({ id }: { id: ResourceThumbnailIconId }) {
  const stroke = { stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (id) {
    case "glucose":
      return (
        <>
          <path d="M12 3c-3 3.8-5 6.9-5 9.3a5 5 0 0 0 10 0C17 9.9 15 6.8 12 3z" {...stroke} />
          <circle cx="10.5" cy="13" r="0.6" fill="currentColor" />
          <circle cx="13" cy="14.3" r="0.6" fill="currentColor" />
          <circle cx="12" cy="11.5" r="0.6" fill="currentColor" />
        </>
      );
    case "alert-signs":
      return (
        <>
          <path d="M12 3.5 2.5 20h19L12 3.5z" {...stroke} />
          <path d="M12 10v4" {...stroke} />
          <circle cx="12" cy="16.7" r="0.9" fill="currentColor" />
        </>
      );
    case "first-steps":
      return (
        <>
          <path d="M6 20V4" {...stroke} />
          <path d="M6 4l9 3.5-6 2.7" {...stroke} />
          <path d="M4 20h6" {...stroke} />
        </>
      );
    case "nutrition":
      return (
        <>
          <circle cx="10.5" cy="12" r="7.5" {...stroke} />
          <path d="M9 8v4.5a1.5 1.5 0 0 0 3 0V8" {...stroke} />
          <path d="M9 8v3" {...stroke} />
          <path d="M17.5 6.5v6a2 2 0 0 1-1.4 1.9V19" {...stroke} />
          <path d="M17.5 6.5v3.2" {...stroke} />
        </>
      );
    case "myth-check":
      return (
        <>
          <circle cx="10.5" cy="10.5" r="6.5" {...stroke} />
          <path d="M15.3 15.3 20 20" {...stroke} />
          <path d="M8 10.7l1.7 1.8L13.3 8" {...stroke} />
        </>
      );
    case "mental-health":
      return (
        <>
          <path
            d="M12 19.5C7 15.9 3.5 12.9 3.5 9a4.2 4.2 0 0 1 7.4-2.7L12 7.6l1.1-1.3A4.2 4.2 0 0 1 20.5 9c0 3.9-3.5 6.9-8.5 10.5z"
            {...stroke}
          />
          <path d="M8.3 11.3h1.6l1.1-2 1.5 3.4 1-1.4h1.6" {...stroke} />
        </>
      );
    case "routine":
      return (
        <>
          <rect x="3.5" y="4.5" width="17" height="16" rx="2" {...stroke} />
          <path d="M3.5 9.5h17" {...stroke} />
          <path d="M8 3v3M16 3v3" {...stroke} />
          <path d="M8.3 14.2l2 2 4.4-4.4" {...stroke} />
        </>
      );
    case "heart-pulse":
      return (
        <>
          <path
            d="M12 19.3C6.7 15.5 3.5 12.4 3.5 8.9a4.4 4.4 0 0 1 8-2.5.5.5 0 0 0 .9 0 4.4 4.4 0 0 1 8 2.5c0 3.5-3.2 6.6-8.4 10.4z"
            {...stroke}
          />
          <path d="M7 11.5h2l1.3-2.4L12.5 14l1.4-2.5H17" {...stroke} />
        </>
      );
    case "footsteps":
      return (
        <>
          <ellipse cx="8.5" cy="7.5" rx="2.2" ry="3.2" transform="rotate(-18 8.5 7.5)" {...stroke} />
          <ellipse cx="15.5" cy="14.5" rx="2.2" ry="3.2" transform="rotate(18 15.5 14.5)" {...stroke} />
          <path d="M8 11v2.5M16 18v2.5" {...stroke} />
        </>
      );
    case "scale-tape":
      return (
        <>
          <rect x="3.5" y="8" width="17" height="10" rx="2.5" {...stroke} />
          <circle cx="12" cy="13" r="2.4" {...stroke} />
          <path d="M12 13v-1.3" {...stroke} />
          <path d="M7 8V6a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v2" {...stroke} />
        </>
      );
    case "clipboard-check":
      return (
        <>
          <rect x="5" y="4.5" width="14" height="16" rx="2" {...stroke} />
          <path d="M9 4.5V4a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4v.5" {...stroke} />
          <path d="M8.5 13l2.2 2.2L15.7 10" {...stroke} />
        </>
      );
    case "lab-drop":
      return (
        <>
          <path d="M10 3h4" {...stroke} />
          <path d="M11 3v6.5L6.7 17a2 2 0 0 0 1.7 3h7.2a2 2 0 0 0 1.7-3L13 9.5V3" {...stroke} />
          <path d="M7.8 15.5h8.4" {...stroke} />
        </>
      );
    case "reversible-arrow":
      return (
        <>
          <path d="M5 12a7 7 0 0 1 12-4.9M19 12a7 7 0 0 1-12 4.9" {...stroke} />
          <path d="M17 4v3.3h-3.3" {...stroke} />
          <path d="M7 20v-3.3h3.3" {...stroke} />
        </>
      );
    case "pill-classes":
      return (
        <>
          <rect x="3.5" y="9" width="8" height="4.5" rx="2.25" transform="rotate(-25 7.5 11.25)" {...stroke} />
          <path d="M6 13l3-6" {...stroke} />
          <circle cx="16.5" cy="8" r="2.6" {...stroke} />
          <circle cx="16.5" cy="16.5" r="2.6" {...stroke} />
        </>
      );
    case "insulin-pen":
      return (
        <>
          <path d="M6 17.5l-1.6 2.6a.7.7 0 0 0 1 1L7 19.5" {...stroke} />
          <path d="M6 17.5L15.5 8l2 2L8 19.5z" {...stroke} />
          <path d="M13.5 6l4 4" {...stroke} />
          <path d="M15.5 4l4 4" {...stroke} />
        </>
      );
    case "foot-shield":
      return (
        <>
          <path
            d="M9.5 20c-2.6-.3-4-1.6-4-3.6 0-1.6.9-2.2.9-4 0-1.5-.9-2.4-.9-4.2C5.5 5.9 7 4 9 4c1.4 0 1.8 1 3 1s1.7-.7 2.7-.7c2 0 2.8 1.7 2.8 3.4 0 2.6-1.5 3.7-1.5 6.5 0 3.2-2.5 5.5-5 5.8z"
            {...stroke}
          />
          <circle cx="9.3" cy="7.6" r="0.6" fill="currentColor" />
          <circle cx="12.2" cy="7" r="0.6" fill="currentColor" />
          <circle cx="14.8" cy="7.9" r="0.6" fill="currentColor" />
        </>
      );
    case "organs":
      return (
        <>
          <circle cx="8.5" cy="8.5" r="4.5" {...stroke} />
          <path d="M6.8 8.7l1.1 1.2 1.9-2.6" {...stroke} />
          <path
            d="M13.5 12c1.7 0 3 1.5 3 3.4 0 2.6-2.3 4.1-3 4.6-.7-.5-3-2-3-4.6 0-1.9 1.3-3.4 3-3.4z"
            {...stroke}
          />
        </>
      );
    case "hands-heart":
      return (
        <>
          <path
            d="M12 15.5c-3.3-2.4-5.3-4.3-5.3-6.6a3.1 3.1 0 0 1 5.6-1.9.5.5 0 0 0 .7 0 3.1 3.1 0 0 1 5.6 1.9c0 2.3-2 4.2-5.3 6.6z"
            {...stroke}
          />
          <path d="M4 20c1.6-1.8 3-2.6 4.6-2.6h3.6c.7 0 1.2.5 1.2 1.1 0 .7-.5 1.1-1.2 1.1H9.5" {...stroke} />
          <path d="M20 19.3c-1.4-1.6-2.7-2.3-4.1-2.3" {...stroke} />
        </>
      );
    case "salt-shaker":
      return (
        <>
          <path d="M9.5 3.5h5l1 4.5H8.5l1-4.5z" {...stroke} />
          <path d="M8 8h8l1 10.5a2 2 0 0 1-2 2.2H9a2 2 0 0 1-2-2.2L8 8z" {...stroke} />
          <path d="M11 12.2v.01M13 12.8v.01M12 15.5v.01M14 15v.01" {...stroke} />
        </>
      );
    case "oil-drop":
      return (
        <>
          <path d="M12 3.5c2.6 3.6 5 6.9 5 9.8a5 5 0 0 1-10 0c0-2.9 2.4-6.2 5-9.8z" {...stroke} />
          <path d="M9.5 14a2.5 2.5 0 0 0 2.5 2.5" {...stroke} />
        </>
      );
    case "artery":
      return (
        <>
          <path d="M3.5 12h4l1.5-4 2.5 8 1.8-6 1.2 2.6H20.5" {...stroke} />
          <circle cx="17.5" cy="12" r="2.6" {...stroke} />
        </>
      );
    case "ribbon":
      return (
        <>
          <path d="M9.5 9.3L6 4.5h3.2L12 8l2.8-3.5H18l-3.5 4.8" {...stroke} />
          <circle cx="12" cy="14.2" r="4.3" {...stroke} />
          <path d="M12 12.3v3.8M10.3 14.2h3.4" {...stroke} />
        </>
      );
    case "magnifier-check":
      return (
        <>
          <circle cx="10.5" cy="10.5" r="6.5" {...stroke} />
          <path d="M7.5 10.6l2 2.1 3.6-4.2" {...stroke} />
          <path d="M15.2 15.2L20 20" {...stroke} />
        </>
      );
    case "results-envelope":
      return (
        <>
          <rect x="3.5" y="6" width="17" height="12.5" rx="2" {...stroke} />
          <path d="M4 7l8 6.5L20 7" {...stroke} />
          <circle cx="17.5" cy="15.5" r="3.2" fill="white" {...stroke} />
          <path d="M16.2 15.5l.9.9 1.6-1.8" {...stroke} />
        </>
      );
    case "smoke-off":
      return (
        <>
          <path d="M3.5 15.5h11a2.5 2.5 0 0 0 0-5" {...stroke} />
          <path d="M3.5 15.5v3.2h11" {...stroke} />
          <path d="M14.5 10.5v8.2" {...stroke} />
          <path d="M8.5 6.5c.6-.8.6-1.6 0-2.4M11.5 6.5c.6-.8.6-1.6 0-2.4" {...stroke} />
          <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </>
      );
    default:
      return null;
  }
}
