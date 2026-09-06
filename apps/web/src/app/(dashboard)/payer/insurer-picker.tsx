"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/select";
import type { InsurerOption } from "@/lib/payer/scope";

/** Reused on every /payer page that needs to know which insurer it's
 * scoped to — a superadmin or a multi-seat payer_admin picks one via the
 * `insurer` query param; a single-seat payer_admin never sees this at all
 * (resolveSelectedInsurer auto-selects their only option). */
export function InsurerPicker({ options, selectedId }: { options: InsurerOption[]; selectedId?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (options.length <= 1) return null;

  return (
    <div className="max-w-xs">
      <Select
        value={selectedId ?? ""}
        onChange={(e) => {
          const params = new URLSearchParams(searchParams.toString());
          params.set("insurer", e.target.value);
          router.push(`${pathname}?${params.toString()}`);
        }}
      >
        <option value="" disabled>
          Choose an insurer…
        </option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
