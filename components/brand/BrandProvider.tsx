"use client";

import { createContext, useContext } from "react";
import type { AppBrand } from "@/lib/appBrand";

const BrandContext = createContext<AppBrand>({ name: "SLM", initials: "SLM", title: "SLM Internal App", companyName: "Aneka Jaya / SLM" });

export function BrandProvider({ brand, children }: { brand: AppBrand; children: React.ReactNode }) {
  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}

export function useBrand() {
  return useContext(BrandContext);
}
