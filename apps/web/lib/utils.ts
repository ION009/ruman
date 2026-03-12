import { clsx, type ClassValue } from "clsx";
import { format, formatDistanceToNowStrict } from "date-fns";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

export function formatPercent(value: number, digits = 0) {
  return `${value.toFixed(digits)}%`;
}

export function formatCompact(value: number) {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatTimestamp(value: string) {
  return format(new Date(value), "MMM d, yyyy");
}

export function formatDateTime(value?: string | null) {
  if (!value) {
    return "No data yet";
  }
  return format(new Date(value), "MMM d, yyyy 'at' HH:mm");
}

export function timeAgo(value?: string | null) {
  if (!value) {
    return "Not observed";
  }
  return formatDistanceToNowStrict(new Date(value), { addSuffix: true });
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function toRangeKey(days: number) {
  if (days <= 1) {
    return "24h";
  }
  if (days <= 7) {
    return "7d";
  }
  return "30d";
}
