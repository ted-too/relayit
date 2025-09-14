import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n?.[0]?.toUpperCase())
    .slice(0, 2)
    .join("");
}

export function formatCompactNumber(value: number) {
  if (value >= 100 && value < 1000) {
    return value.toString(); // Keep the number as is if it's in the hundreds
  }
  if (value >= 1000 && value < 1_000_000) {
    return `${(value / 1000).toFixed(1)}k`; // Convert to 'k' for thousands
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`; // Convert to 'M' for millions
  }
  return value.toString(); // Optionally handle numbers less than 100 if needed
}
