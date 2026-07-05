import Image from "next/image";
import { SignUpForm } from "@/components/auth/sign-up-form";

export default function SignUpPage() {
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
      <SignUpForm />
    </div>
  );
}
