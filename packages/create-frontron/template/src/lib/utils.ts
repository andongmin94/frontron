import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function hasDesktopBridgeRuntime() {
  return typeof window !== "undefined" && Boolean(window.__FRONTRON_BRIDGE__)
}
