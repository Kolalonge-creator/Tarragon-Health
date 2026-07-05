import type { ButtonHTMLAttributes, InputHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
};

const variantClasses: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "bg-brand-green text-white hover:bg-brand-green/90 disabled:opacity-50",
  secondary:
    "border border-brand-navy/20 bg-white text-brand-navy hover:bg-brand-ivory disabled:opacity-50",
  ghost: "text-brand-navy hover:bg-brand-ivory disabled:opacity-50",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex h-11 items-center justify-center rounded-lg px-4 text-sm font-medium transition-colors ${variantClasses[variant]} ${className}`}
      {...props}
    />
  );
}

export function Input({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`h-11 w-full rounded-lg border border-brand-navy/15 bg-white px-3 text-sm text-brand-ink placeholder:text-brand-ink/45 focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/20 ${className}`}
      {...props}
    />
  );
}

export function Label({
  children,
  htmlFor,
}: {
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block text-sm font-medium text-brand-navy"
    >
      {children}
    </label>
  );
}

export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="w-full max-w-md rounded-2xl border border-brand-navy/10 bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-semibold text-brand-navy">{title}</h1>
      <p className="mt-2 text-sm text-brand-ink/70">{subtitle}</p>
      <div className="mt-6">{children}</div>
    </div>
  );
}
