import Image from "next/image";

/**
 * Generic real-screenshot phone bezel, factored out of app-dashboard-mockup.tsx
 * so every product page can drop in its own real screen (captured from the
 * Expo app against a live QA account) instead of a stylised illustration —
 * same reasoning the brand guide applies to hero photography: a real product
 * screen reads as more credible than a facsimile.
 *
 * `showNotch` only makes sense for a screenshot that still has its own OS
 * status bar baked in (the notch/pill masks the camera cutout there); screens
 * cropped to start at the app's own header should leave it off.
 */
export function PhoneMockup({
  src,
  alt,
  width,
  height,
  className,
  frameWidth = 280,
  showNotch = false,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  frameWidth?: number;
  showNotch?: boolean;
}) {
  return (
    <div className={className}>
      <div
        className="relative mx-auto rounded-[36px] bg-clinical-navy p-3.5 shadow-2xl shadow-charcoal-ink/25"
        style={{ width: frameWidth }}
      >
        {showNotch ? (
          <div
            className="absolute left-1/2 top-3.5 z-10 h-5 w-24 -translate-x-1/2 rounded-b-2xl bg-clinical-navy"
            aria-hidden
          />
        ) : null}
        <div
          className="w-full overflow-hidden rounded-[24px] bg-warm-ivory"
          style={{ aspectRatio: `${width} / ${height}` }}
        >
          <Image
            src={src}
            alt={alt}
            width={width}
            height={height}
            className="h-full w-full object-cover object-top"
            sizes={`${frameWidth}px`}
          />
        </div>
      </div>
    </div>
  );
}
