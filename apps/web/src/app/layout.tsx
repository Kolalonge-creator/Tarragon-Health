import type { Metadata } from "next";
import { Suspense } from "react";
import { Sora, Inter } from "next/font/google";
import "./globals.css";
import { PageTracker } from "@/components/analytics/page-tracker";

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TarragonHealth — Care that stays with you",
  description:
    "Nigeria's digital-first chronic disease, preventive health, and family care coordination platform.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${sora.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Suspense fallback={null}>
          <PageTracker />
        </Suspense>
      </body>
    </html>
  );
}
