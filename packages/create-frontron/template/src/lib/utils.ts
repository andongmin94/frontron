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
    typeof bridge.hideWindow !== "function" ||
    typeof bridge.minimizeWindow !== "function" ||
    typeof bridge.toggleMaximizeWindow !== "function" ||
    typeof bridge.quitApp !== "function" ||
    typeof bridge.getWindowState !== "function" ||
    typeof bridge.onWindowMaximizedChanged !== "function"
  ) {
    return null
  }

  return bridge
}

export function hasDesktopBridgeRuntime() {
  return getDesktopBridgeRuntime() !== null
}
