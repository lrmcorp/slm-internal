import type { InputHTMLAttributes } from "react";
export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`block w-full rounded-sm border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-brand-600 focus:ring-1 focus:ring-brand-600 disabled:bg-neutral-100 ${className}`} {...props} />;
}
