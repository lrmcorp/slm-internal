import type { Metadata } from "next";
import { getAppBrand } from "@/lib/appBrand";
import { BrandProvider } from "@/components/brand/BrandProvider";
import { TopLoadingBar } from "@/components/ui/TopLoadingBar";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { Suspense } from "react";
import "./globals.css";

export function generateMetadata(): Metadata {
  const brand = getAppBrand();
  return {
    title: brand.title,
    description: `Aplikasi operasional internal ${brand.companyName}`,
    icons: { icon: "/brand-icon.svg", shortcut: "/brand-icon.svg", apple: "/brand-icon.svg" }
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" data-accent={getAppBrand().accent ?? undefined}>
      <body suppressHydrationWarning>
        <Suspense fallback={null}>
          <TopLoadingBar />
        </Suspense>
        <BrandProvider brand={getAppBrand()}>
          <ToastProvider>{children}</ToastProvider>
        </BrandProvider>
      </body>
    </html>
  );
}

