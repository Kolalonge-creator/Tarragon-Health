"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useMapsLibrary } from "@vis.gl/react-google-maps";
import { Input } from "@/components/ui/input";
import { placeToAddress, type PlaceAddress } from "@/lib/maps/place-address";

/**
 * An address box that suggests real Nigerian addresses as the admin types (Google Places API (New), restricted to region "ng"),
 * and on a pick fills in the formatted address plus coordinates, state and town (see placeToAddress). Used by the admin partner
 * location forms, inside MapsProvider.
 *
 * Fails soft: with no Maps key, Places not enabled, or a request that errors, it is an ordinary text box and the existing Geocode
 * button / typed coordinates still work. One session token covers a run of keystrokes and the single fetchFields that ends it, so a
 * typed address is billed as one session, not per keystroke; a fresh token starts after each pick.
 */
const MIN_CHARS = 3;
const DEBOUNCE_MS = 250;

type Suggestion = { id: string; text: string; prediction: google.maps.places.PlacePrediction };

export function AddressAutocompleteInput({
  value,
  onChange,
  onSelect,
  placeholder,
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (text: string) => void;
  onSelect: (address: PlaceAddress) => void;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const places = useMapsLibrary("places");
  const listId = useId();
  const sessionToken = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  // the text a pick just wrote into the box: no suggestions are fetched for it (a pick changes the text twice)
  const picked = useRef<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!places) return;
    const query = value.trim();
    if (query.length < MIN_CHARS || value === picked.current) {
      setSuggestions([]);
      // a box cleared without a pick ends that session, so the next address starts a fresh one (a reused token is billed per request)
      if (query.length < MIN_CHARS) sessionToken.current = null;
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      sessionToken.current ??= new places.AutocompleteSessionToken();
      try {
        const { suggestions: found } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: query,
          includedRegionCodes: ["ng"],
          sessionToken: sessionToken.current,
        });
        if (cancelled) return;
        setSuggestions(
          found.flatMap((s) => (s.placePrediction ? [{ id: s.placePrediction.placeId, text: s.placePrediction.text.text, prediction: s.placePrediction }] : [])),
        );
        setActive(-1);
        setError(null);
      } catch {
        // Suggestions are a convenience: on any failure the box stays a plain text field.
        if (!cancelled) setSuggestions([]);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [places, value]);

  async function pick(s: Suggestion) {
    setOpen(false);
    setSuggestions([]);
    picked.current = s.text;
    onChange(s.text);
    try {
      const place = s.prediction.toPlace();
      await place.fetchFields({ fields: ["formattedAddress", "location", "addressComponents"] });
      const address = placeToAddress(place, s.text);
      picked.current = address.address;
      onChange(address.address);
      onSelect(address);
    } catch {
      setError("Could not load that address. Keep the text and use Geocode, or enter coordinates directly.");
    } finally {
      sessionToken.current = null;
    }
  }

  const showList = open && suggestions.length > 0;

  return (
    <div className="relative w-full">
      <Input
        role="combobox"
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        placeholder={placeholder}
        className={className}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setError(null);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (!showList) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, suggestions.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            void pick(suggestions[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-charcoal-ink/10 bg-white py-1 text-sm shadow-md"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`cursor-pointer px-3 py-1.5 ${i === active ? "bg-charcoal-ink/5" : ""}`}
              // mousedown, not click: it fires before the input's blur closes the list
              onMouseDown={(e) => {
                e.preventDefault();
                void pick(s);
              }}
            >
              {s.text}
            </li>
          ))}
          <li aria-hidden="true" className="px-3 pt-1 text-right text-[10px] text-charcoal-ink/40">
            Powered by Google
          </li>
        </ul>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
