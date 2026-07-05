import { Suspense } from "react";
import Image from "next/image";
import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-brand-ivory px-4 py-12">
      <div className="mb-8 flex flex-col items-center gap-3 text-center">
        <Image
          src="/brand/logo-mark.png"
          alt="TarragonHealth"
          width={48}
          height={48}
        />
        <p className="text-sm text-brand-ink/70">Care that stays with you.</p>
      </div>
      <Suspense fallback={<div className="text-sm text-brand-ink/70">Loading…</div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
