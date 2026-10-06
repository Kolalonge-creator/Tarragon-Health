import Link from "next/link";

/** Section links shared by the admin and the Chief Medical Officer credentialing pages. */
export function CredentialingNav({ basePath, showContent }: { basePath: string; showContent: boolean }) {
  const links = [
    { href: basePath, label: "Applications" },
    { href: `${basePath}/expiry`, label: "Licences and cover" },
    ...(showContent ? [{ href: `${basePath}/content`, label: "Training and test content" }] : []),
  ];
  return (
    <nav aria-label="Credentialing sections" className="flex flex-wrap gap-4 border-b border-charcoal-ink/10 pb-2 text-sm dark:border-night-ink/15">
      {links.map((l) => (
        <Link key={l.href} href={l.href} className="font-medium text-brand-green underline-offset-4 hover:underline">
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
