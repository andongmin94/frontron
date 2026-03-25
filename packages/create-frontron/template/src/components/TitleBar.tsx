import type { CSSProperties } from "react"
import { useEffect, useState } from "react"
import { Copy, Minus, Square, X } from "lucide-react"

import { bridge } from "frontron/client"

import { Button } from "@/components/ui/button"
import { hasDesktopBridgeRuntime } from "@/lib/utils"

import appLogo from "/logo.svg"

const TITLE_BAR_HEIGHT = 40
const DRAG_STYLE = { WebkitAppRegion: "drag" } as CSSProperties
const NO_DRAG_STYLE = {
  WebkitAppRegion: "no-drag",
  cursor: "pointer",
} as CSSProperties
const WEB_PREVIEW_TEXT = "Web preview"
const BRIDGE_CHECKING_TEXT = "Connecting desktop bridge..."
const BRIDGE_ERROR_TEXT = "Desktop bridge unavailable"

export default function TitleBar() {
  const hasDesktopBridge = hasDesktopBridgeRuntime()
  const [bridgeMode, setBridgeMode] = useState<
    "checking" | "desktop" | "preview" | "error"
  >(hasDesktopBridge ? "checking" : "preview")
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    if (!hasDesktopBridge) {
      return undefined
    }

    let cancelled = false
    let unsubscribe: (() => void) | undefined

    async function connectWindowBridge() {
      try {
        unsubscribe = bridge.window.onMaximizedChanged((value: boolean) => {
          if (cancelled) {
            return
          }

          setBridgeMode("desktop")
          setIsMaximized(Boolean(value))
        })

        const state = await bridge.window.getState()

        if (cancelled) {
          return
        }

        setBridgeMode("desktop")
        setIsMaximized(Boolean(state.isMaximized))
      } catch (error) {
        if (cancelled) {
          return
        }

        console.error("[Frontron] Failed to connect the desktop bridge.", error)
        setBridgeMode("error")
      }
    }

    void connectWindowBridge()

    return () => {
      cancelled = true
      if (typeof unsubscribe === "function") {
        unsubscribe()
      }
    }
  }, [hasDesktopBridge])

  const title =
    typeof document === "undefined" || !document.title
      ? "Frontron App"
      : document.title

  const runWindowAction = (label: string, action: () => Promise<unknown>) => {
    void action().catch((error: unknown) => {
      console.error(`[Frontron] Failed to ${label}.`, error)
      setBridgeMode("error")
    })
  }

  return (
    <>
      <div
        className="fixed inset-x-0 top-0 z-50 flex h-10 items-center justify-between border-b border-white/10 bg-zinc-950 px-2.5 text-zinc-50 shadow-sm"
        style={DRAG_STYLE}
      >
        <div className="flex items-center gap-2.5 overflow-hidden px-1.5 select-none">
          <img src={appLogo} alt="" className="size-[18px] shrink-0" />
          <span className="truncate text-sm font-medium">{title}</span>
        </div>
        <div className="flex items-center gap-1.5 pr-1" style={NO_DRAG_STYLE}>
          {bridgeMode === "desktop" ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Minimize window"
                className="size-8 cursor-pointer rounded-md text-zinc-50 hover:bg-white/10 hover:text-white disabled:cursor-default disabled:opacity-40"
                style={NO_DRAG_STYLE}
                onClick={() =>
                  runWindowAction("minimize the window", () =>
                    bridge.window.minimize(),
                  )
                }
              >
                <Minus className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={isMaximized ? "Restore window" : "Maximize window"}
                className="size-8 cursor-pointer rounded-md text-zinc-50 hover:bg-white/10 hover:text-white disabled:cursor-default disabled:opacity-40"
                style={NO_DRAG_STYLE}
                onClick={() =>
                  runWindowAction("toggle maximize", () =>
                    bridge.window.toggleMaximize(),
                  )
                }
              >
                {isMaximized ? (
                  <Copy className="size-3.5" />
                ) : (
                  <Square className="size-3.5" />
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Hide window"
                className="size-8 cursor-pointer rounded-md text-zinc-50 hover:bg-red-500/80 hover:text-white disabled:cursor-default disabled:opacity-40"
                style={NO_DRAG_STYLE}
                onClick={() =>
                  runWindowAction("hide the window", () => bridge.window.hide())
                }
              >
                <X className="size-3.5" />
              </Button>
            </>
          ) : (
            <span className="px-3 text-xs font-medium text-zinc-50">
              {bridgeMode === "preview"
                ? WEB_PREVIEW_TEXT
                : bridgeMode === "checking"
                  ? BRIDGE_CHECKING_TEXT
                  : BRIDGE_ERROR_TEXT}
            </span>
          )}
        </div>
      </div>
      <div style={{ height: TITLE_BAR_HEIGHT }} />
    </>
  )
}
