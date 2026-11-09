import type { Metadata, Viewport } from "next";
import { brandHex, getAppBrand } from "@/lib/appBrand";
import { BrandProvider } from "@/components/brand/BrandProvider";
import { TopLoadingBar } from "@/components/ui/TopLoadingBar";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { ServiceWorkerRegister } from "@/components/pwa/ServiceWorkerRegister";
import { Suspense } from "react";
import "./globals.css";

export function generateMetadata(): Metadata {
  const brand = getAppBrand();
  return {
    title: brand.title,
    description: `Aplikasi operasional internal ${brand.companyName}`,
    icons: { icon: "/brand-icon.svg", shortcut: "/brand-icon.svg", apple: "/pwa-icon/180" },
    // Dipasang di iPhone lewat Safari > Bagikan > Tambah ke Layar Utama: terbuka layar penuh tanpa App Store.
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, title: brand.name, statusBarStyle: "default" }
  };
}

export function generateViewport(): Viewport {
  return { themeColor: brandHex() };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" data-accent={getAppBrand().accent ?? undefined}>
      <body suppressHydrationWarning>
        <Suspense fallback={null}>
          <TopLoadingBar />
        </Suspense>
        <ServiceWorkerRegister />
        <BrandProvider brand={getAppBrand()}>
          <ToastProvider>{children}</ToastProvider>
        </BrandProvider>
      </body>
    </html>
  );
}

