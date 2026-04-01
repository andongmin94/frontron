import type { CSSProperties, ReactNode } from "react"
import { useEffect, useState } from "react"
import { Copy, Minus, Square, X } from "lucide-react"

import { useCloseButtonBehavior } from "@/lib/desktop-settings"
import { getDesktopBridgeRuntime } from "@/lib/utils"

const TITLE_BAR_HEIGHT = 40
const DRAG_STYLE = { WebkitAppRegion: "drag" } as CSSProperties
const NO_DRAG_STYLE = {
  WebkitAppRegion: "no-drag",
  cursor: "pointer",
} as CSSProperties
const WEB_PREVIEW_TEXT = "Web preview"
const BRIDGE_CHECKING_TEXT = "Connecting Electron bridge..."
const BRIDGE_ERROR_TEXT = "Electron bridge unavailable"
const WINDOW_CONTROL_BUTTON_CLASS =
  "flex h-full min-w-[46px] items-center justify-center border-0 bg-transparent p-0 text-zinc-400 transition-colors outline-none hover:bg-white/[0.08] hover:text-zinc-100 focus-visible:bg-white/[0.08] focus-visible:text-zinc-100 disabled:cursor-default disabled:opacity-40"
const CLOSE_BUTTON_CLASS =
  "flex h-full min-w-[46px] items-center justify-center border-0 bg-transparent p-0 text-zinc-400 transition-colors outline-none hover:bg-[#e81123] hover:text-white focus-visible:bg-[#e81123] focus-visible:text-white disabled:cursor-default disabled:opacity-40"
const WINDOW_CONTROL_ICON_CLASS = "size-[13px] stroke-[2.05]"

type WindowControlButtonProps = {
  ariaLabel: string
  className: string
  onClick: () => void
  children: ReactNode
}

function WindowControlButton({
  ariaLabel,
  className,
  onClick,
  children,
}: WindowControlButtonProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className={className}
      style={NO_DRAG_STYLE}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export default function TitleBar() {
  const [bridgeMode, setBridgeMode] = useState<
    "checking" | "desktop" | "preview" | "error"
  >("checking")
  const [isMaximized, setIsMaximized] = useState(false)
  const [closeButtonBehavior] = useCloseButtonBehavior()

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined

    async function connectWindowBridge() {
      const electronApi = getDesktopBridgeRuntime()

      if (!electronApi) {
        if (!cancelled) {
          setBridgeMode("preview")
        }
        return
      }

      try {
        unsubscribe = electronApi?.onWindowMaximizedChanged((value) => {
          if (cancelled) {
            return
          }

          setBridgeMode("desktop")
          setIsMaximized(Boolean(value))
        })

        const state = await electronApi?.getWindowState()

        if (cancelled) {
          return
        }

        setBridgeMode("desktop")
        setIsMaximized(Boolean(state?.isMaximized))
      } catch (error) {
        if (cancelled) {
          return
        }

        console.error(
          "[template] Failed to connect the Electron bridge.",
          error
        )
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
  }, [])

  const title =
    typeof document === "undefined" || !document.title
      ? "Desktop App"
      : document.title
  const desktopStatusLabel =
    bridgeMode === "preview"
      ? WEB_PREVIEW_TEXT
      : bridgeMode === "checking"
        ? BRIDGE_CHECKING_TEXT
        : bridgeMode === "error"
          ? BRIDGE_ERROR_TEXT
          : null
  const hasWindowControls = bridgeMode === "desktop"
  const closeButtonActionLabel =
    closeButtonBehavior === "quit" ? "Quit app" : "Hide window"

  const runWindowAction = (label: string, action: () => void) => {
    try {
      action()
    } catch (error: unknown) {
      console.error(`[template] Failed to ${label}.`, error)
      setBridgeMode("error")
    }
  }

  return (
    <>
      <div
        className="fixed inset-x-0 top-0 z-50 flex h-10 items-stretch justify-between border-b border-white/[0.06] bg-[#202124] text-zinc-100"
        style={DRAG_STYLE}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden pr-3 pl-3 select-none">
          <div className="flex size-4 shrink-0 items-center justify-center">
            <img
              src="/logo.svg"
              alt=""
              aria-hidden="true"
              className="size-4"
              draggable={false}
            />
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <div className="truncate text-[12px] font-normal tracking-[0.01em] text-zinc-200">
              {title}
            </div>
            {desktopStatusLabel ? (
              <>
                <span className="h-3 w-px bg-white/[0.08]" />
                <span className="truncate text-[11px] font-medium text-zinc-500">
                  {desktopStatusLabel}
                </span>
              </>
            ) : null}
          </div>
        </div>
        <div
          className="-mb-px flex h-[calc(100%+1px)] items-stretch self-stretch"
          style={NO_DRAG_STYLE}
        >
          {hasWindowControls ? (
            <>
              <WindowControlButton
                ariaLabel="Minimize window"
                className={WINDOW_CONTROL_BUTTON_CLASS}
                onClick={() =>
                  runWindowAction("minimize the window", () =>
                    getDesktopBridgeRuntime()?.minimizeWindow()
                  )
                }
              >
                <Minus className={WINDOW_CONTROL_ICON_CLASS} />
              </WindowControlButton>
              <WindowControlButton
                ariaLabel={isMaximized ? "Restore window" : "Maximize window"}
                className={WINDOW_CONTROL_BUTTON_CLASS}
                onClick={() =>
                  runWindowAction("toggle maximize", () =>
                    getDesktopBridgeRuntime()?.toggleMaximizeWindow()
                  )
                }
              >
                {isMaximized ? (
                  <Copy className={WINDOW_CONTROL_ICON_CLASS} />
                ) : (
                  <Square className={WINDOW_CONTROL_ICON_CLASS} />
                )}
              </WindowControlButton>
              <WindowControlButton
                ariaLabel={closeButtonActionLabel}
                className={CLOSE_BUTTON_CLASS}
                onClick={() =>
                  runWindowAction(
                    closeButtonBehavior === "quit"
                      ? "quit the app"
                      : "hide the window",
                    () =>
                      closeButtonBehavior === "quit"
                        ? getDesktopBridgeRuntime()?.quitApp()
                        : getDesktopBridgeRuntime()?.hideWindow()
                  )
                }
              >
                <X className={WINDOW_CONTROL_ICON_CLASS} />
              </WindowControlButton>
            </>
          ) : null}
        </div>
      </div>
      <div style={{ height: TITLE_BAR_HEIGHT }} />
    </>
  )
}
