"use client";

import { useBrand } from "@/components/brand/BrandProvider";

/**
 * Logo instance. Instance dengan logo gambar (mis. SLMJ) menampilkan logonya;
 * instance lain tetap kotak inisial berwarna brand.
 */
export function BrandMark({ variant = "mark", boxClassName, imageClassName }: { variant?: "mark" | "full"; boxClassName: string; imageClassName?: string }) {
  const brand = useBrand();
  if (brand.logo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={variant === "full" ? brand.logo.full : brand.logo.mark} alt={brand.name} className={imageClassName ?? "h-8 w-auto shrink-0"} />;
  }
  return <span className={boxClassName}>{brand.initials}</span>;
}
