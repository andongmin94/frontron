import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getDesktopBridgeRuntime() {
  if (typeof window === "undefined") {
    return null
  }

  const bridge = window.electron

  if (
    !bridge ||
    typeof bridge.getAppInfo !== "function" ||
    typeof bridge.openTextFile !== "function" ||
    typeof bridge.saveTextFile !== "function" ||
    typeof bridge.readClipboardText !== "function" ||
    typeof bridge.writeClipboardText !== "function" ||
    typeof bridge.showNotification !== "function"
  ) {
    return null
  }

  return bridge
}

export function hasDesktopBridgeRuntime() {
  return getDesktopBridgeRuntime() !== null
}
