"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/select";
import type { ProviderOrgOption } from "@/lib/provider-org/scope";

export function OrgPicker({ options, selectedId }: { options: ProviderOrgOption[]; selectedId?: string }) {
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
          params.set("org", e.target.value);
          router.push(`${pathname}?${params.toString()}`);
        }}
      >
        <option value="" disabled>
          Choose an organisation…
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
