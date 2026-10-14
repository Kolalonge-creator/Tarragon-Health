/**
 * A member's picture, shown to staff. The route behind the address checks who is asking, so the address alone is not a way in.
 * Never taller than 24rem. The alt text says what the picture is for, not what is in it (staff read the picture itself).
 */
export function PostPicture({ imageId, label = "Picture attached to this post" }: { imageId: string; label?: string }) {
  return (
    // A plain img on purpose: the picture is private and served by an authorising route, so the image optimiser must not fetch it.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/community/images/${encodeURIComponent(imageId)}`}
      alt={label}
      loading="lazy"
      className="max-h-96 max-w-full rounded-md border border-charcoal-ink/15 bg-warm-ivory object-contain"
    />
  );
}

export const PICTURE_CHECKLIST =
  "No faces of other people, no names, phone numbers, emails or addresses, no medicine labels that show who someone is, nothing graphic or private. If unsure, remove it.";

/** The short list a moderator checks a picture against before approving it. */
export function PictureChecklist() {
  return (
    <div className="rounded-md border border-charcoal-ink/15 bg-warm-ivory p-3 text-sm text-charcoal-ink">
      <p className="font-medium">Check the picture</p>
      <p>{PICTURE_CHECKLIST}</p>
    </div>
  );
}
